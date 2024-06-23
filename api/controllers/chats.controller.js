const axios = require('axios');
const Instance = require('../models/instanceModel')
const {Message, Contact, ChatLogs} = require('../models/chatModel');
const Campaign = require('../models/campaignModel');
const Event = require('../models/event.Model');
const User = require('../models/user');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs')
const { getCachedData } = require('../middlewares/cache');
const moment = require('moment-timezone');
const handlebars = require('handlebars');
const csv = require('csvtojson');
const dataKey = 'activeSet';
const xlsx = require('xlsx');
const pdf = require('html-pdf');
const path = require('path');

const saveContact = async(req, res)=>{
    try {
      const {name , invites, number, instanceId, campaignId} = req.body
      const existingContact = await Contact.findOne({
        $or: [
          { name },
          { number }
          ]
        });
  
        if (existingContact) {
          let errorMessage = 'Contact already exists with the same ';
          const errors = [];
          if (existingContact.name === name) errors.push('name');
          if (existingContact.number === number) errors.push('number');

          errorMessage += errors.join(' or ') + '.';

          return res.status(400).send({ error: errorMessage });
        } 
        const contact = new Contact(req.body);
        await contact.save();
        return res.status(201).send(contact);
      } catch (error) {
        // console.log(error)
        return res.status(500).send({ error: error.message });
      }
}

const saveContactsInBulk = async(req, res) => {
  try {
    const filePath = req.file.path;
    const {instanceId, campaignId} = req.body;

    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    const headers = sheet[0];
    const data = sheet.slice(1).map(row => {
      let contact = {};
      headers.forEach((header, index) => {
        contact[header] = row[index];
      });
      contact.createdBy = req.user.userId;
      // Add instance_id and campaignId if available in req.body
      contact.instanceId = req.body.instanceId || null;
      contact.eventId = req.body.eventId || null;
      return contact;
    });

    await Contact.insertMany(data);

    res.status(201).json({ message: 'Contacts saved successfully' });
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: 'An error occurred while saving contacts' });
  }
}

const getContact = async(req, res)=>{
    try {
      let query = {};
      const { page, limit, searchtext, campaignId, filter} = req.query;
      if (campaignId) {
        query.campaignId = campaignId;
      }
      
      if (searchtext) {
        query.$or = [
          { name: { $regex: new RegExp(searchtext, 'i') } },
          { invites: { $regex: new RegExp(searchtext, 'i') } },
          { number: { $regex: new RegExp(searchtext, 'i') } }
        ];
      }
      if(filter){
        if (filter === 'Pending') {
          query.inviteStatus = { $nin: ['Accepted', 'Rejected'] };
        } else {
          query.inviteStatus = filter;
        }
      }
      // console.log('query', query)
      const Contacts = await Contact.find(query)
        .skip((page - 1) * limit)
        .limit(limit);
      const count = await Contact.countDocuments(query)

      return res.status(200).json({data: Contacts, total: count});

      } catch (error) {
        // console.log(error)
        return res.status(500).send({ error: error.message });
      }
}

const updateContacts = async(req, res)=>{
    try {
        const { id } = req.params;
        const contact = await Contact.findByIdAndUpdate(id, req.body, { new: true });
        if (!contact) {
          return res.status(404).send({ message: 'Contact not found' });
        }
        res.status(200).send(contact);
      } catch (error) {
        // console.log(error)
        return res.status(500).send({ error: error.message });
      }
}

const getMessages = async (req, res)=>{
    try {
        const {senderNumber, instanceId} = req.body;
        
        const instance = await Instance.findOne({_id:instanceId})

        const senderId = req.user.userId;
        
        console.log(senderNumber, instance?.instance_id)
        console.log(senderId)

        const messages = await Message.find({ 
          senderNumber: ''+ senderNumber,
          instanceId: instance.instance_id     
         }).sort({ createdAt: 1 });

        res.status(200).send(messages);
      } catch (error) {
        // console.log(error)
        return res.status(500).send({ error: error.message });
      }
}

const processContact = async (number, instance, campaign, messageTrack,  message, media, mime) => {
  const sendMessageObj = {
    number: number,
    type: 'text',
    instance_id: instance?.instance_id,
  }; 

    let reply = message;
    if (media) {
      sendMessageObj.filename = media.split('/').pop();
      sendMessageObj.media_url = process.env.IMAGE_URL + media;
      sendMessageObj.type = 'media';
    }
    
    const response = await sendMessageFunc({ ...sendMessageObj, message: reply });
    const NewChatLog = await ChatLogs.findOneAndUpdate(
      {
        senderNumber: number,
        instanceId: instance?.instance_id,
        eventId: campaign._id,
      },
      {
        $set: {
          messageTrack: messageTrack,
          finalResponse:'',
          updatedAt: Date.now(),
        },
      },
      {
        upsert: true,
        new: true,
      }
    );
  
};

const sendMessagesWithDelay = async (numbers, instance, campaign, messageTrack,  message, media, mime) => {
  for (let i = 0; i < numbers.length; i++) {
    await processContact(numbers[i], instance, campaign, messageTrack, message, media, mime);
    await new Promise(resolve => setTimeout(resolve, 7500)); // Delay of 7 seconds between each message
  }
};

const sendBulkMessage = async (req, res) => {
  try {
   
    const { instance_id, eventId, message, media, mime, number, filter, messageTrack } = req.body;
    const senderId = req.user.userId;

    let messageNumbers = number;

    const instance = await Instance.findOne({ _id: instance_id });
    const campaign = await Event.findOne({ _id: eventId });
    if(!number?.length){
      const contactQuery ={eventId: eventId}
      if(filter){
        if (filter === 'Pending') {
          contactQuery.inviteStatus = { $nin: ['Accepted', 'Rejected'] };
        } else {
          contactQuery.inviteStatus = filter;
        }
      }
      const contacts = await Contact.find(contactQuery);
      messageNumbers = contacts.map(contact => contact.number);
    }

    // Run the message sending task asynchronously
    sendMessagesWithDelay(messageNumbers, instance, campaign, messageTrack, message, media, mime)
      .then(() => {
        console.log('All messages sent');
      })
      .catch(error => {
        console.error('Error sending messages:', error);
      });

    // Send an immediate response to the client
    return res.status(201).send({ message: 'Message sending job queued' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};

const sendMessages = async (req, res)=>{
  try {

    const { numbers, instance_id, eventId, message, messageTrack } = req.body;

    const senderId = req.user.userId
    const instance = await Instance.findOne({_id:instance_id})
    // Save the message to the database
    let start = new Date();
    start.setHours(0,0,0,0);

    let end = new Date();
    end.setHours(23,59,59,999);
    console.log('numbers', numbers)
    const campaign = await Event.findOne({_id: eventId})
    for(let number of numbers){
      console.log('number',number)
      const sendMessageObj={
        number: number,
        type: 'text',
        instance_id: instance?.instance_id,
      }

      if(messageTrack==1){
  
        let reply = campaign?.invitationText
        if(campaign?.invitationMedia){              
          sendMessageObj.filename = campaign?.invitationMedia.split('/').pop();
          sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.invitationMedia;
          sendMessageObj.type = 'media';
        }
        const response = await sendMessageFunc({...sendMessageObj,message: reply });
        const NewChatLog = await ChatLogs.findOneAndUpdate(
          {
            senderNumber: number,
            instanceId: instance?.instance_id,
            eventId : campaign._id,
            messageTrack:  1
          },
          {
            $set: {
              updatedAt: Date.now(),
            }
          },
          {
            upsert: true, // Create if not found, update if found
            new: true // Return the modified document rather than the original
          }
        )
      }else{
        const response = await sendMessageFunc({...sendMessageObj,message });

      }
    }

    // console.log('response', response.data)
    
    return res.status(201).send({message:'mesg sent'});
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.data });
  }
}


const recieveMessagesV2 = async (req, res)=>{
  try{
    const messageObject = req.body;
    console.log(req.body?.data?.event)
    // if(messageObject.data?.data?.messages?.[0]?.key?.fromMe === true) return res.send()
    if(["messages.upsert"].includes(req.body?.data?.event)){
      let message;
      message = messageObject.data.data.messages?.[0]?.message?.extendedTextMessage?.text || messageObject.data.data.messages?.[0]?.message?.conversation || '';
      let remoteId = messageObject.data.data.messages?.[0]?.key.remoteJid.split('@')[0];

      let fromMe = messageObject.data.data.messages?.[0]?.key?.fromMe
      let messageId = messageObject.data.data.messages?.[0]?.key?.id
      let timeStamp = messageObject.data.data.messages?.[0]?.messageTimestamp

      if(isNaN(remoteId.length)||remoteId.length>13){
        return res.send('invalid number')
      }

      let start = new Date();
      start.setHours(0,0,0,0);

      let end = new Date();
      end.setHours(23,59,59,999);


      console.log('message', messageObject.data.data.messages?.[0]?.message)
      console.log('remoteId', remoteId)

      const recieverId = await Instance.findOne({instance_id: messageObject.instance_id})
      const senderId = await Contact.findOne({number: remoteId})

      if(!senderId) return res.send('No contacts in db');

      const newMessage = {
        recieverId : recieverId?._id,
        senderNumber: remoteId,
        instanceId: messageObject?.instance_id,
        fromMe: fromMe,
        text: message,
        type: 'text',
        messageId,
        timeStamp
      }
      console.log('newMessage', newMessage)
      const savedMessage = new Message(newMessage);
      await savedMessage.save();

      const sendMessageObj={
        number: remoteId,
        type: 'text',
        instance_id: messageObject?.instance_id,
      }

      const tempEvent = await Event.findOne({_id: senderId.eventId})

      if(message.toLowerCase()===tempEvent?.ReportKeyword && senderId?.isAdmin){
        if(!senderId?.isAdmin){
          const response =  await sendMessageFunc({...sendMessageObj, message: 'Invalid Input' });
          return res.send(true);
        }
        const fileName = await getReportdataByTime(start,end, recieverId?._id, tempEvent?._id )
        // const fileName = 'http://5.189.156.200:84/uploads/reports/Report-1716394369435.csv'
        sendMessageObj.filename = fileName.split('/').pop();
        sendMessageObj.media_url= process.env.IMAGE_URL+fileName;
        sendMessageObj.type = 'media';
        const response =  await sendMessageFunc({...sendMessageObj, message:'Download report'});
        return res.send(true);
      }
      
      if(message.toLowerCase()===tempEvent?.StatsKeyword && senderId?.isAdmin){
        if(!senderId?.isAdmin){
          const response =  await sendMessageFunc({...sendMessageObj, message: 'Invalid Input' });
          return res.send(true);
        }

        const replyObj = await getStats1(tempEvent?._id , recieverId,'','');

        let replyMessage = '*Statistics*';
        replyMessage += '\n\n';
        replyMessage += `\n● Total nos of Invitees *${replyObj?.totalContacts}*`;
        replyMessage += `\n● Yes *${replyObj?.yes}*`;
        replyMessage += `\n● No *${replyObj?.no}*`;
        replyMessage += `\n● Balance *${replyObj?.balance}*`;
        
        const response = await sendMessageFunc({...sendMessageObj, message: replyMessage});
        return res.send(true);
      }

      const previousChatLog = await ChatLogs.findOne(
        {
          senderNumber: remoteId,
          instanceId: messageObject?.instance_id,
          eventId: senderId.eventId
        },
      ).sort({ updatedAt: -1 });

      if(fromMe) {
        console.log('here')
        const campaign = await Event.findOne({_id: previousChatLog?.eventId})
        const code = message.split('/') 
        if(code[0].toLowerCase() === campaign.initialCode.toLowerCase()){
          const codeType = code[1].toLowerCase()
          if(codeType === campaign.inviteCode){

            let reply = campaign?.invitationText
            if(campaign?.invitationMedia){              
              sendMessageObj.filename = campaign?.invitationMedia.split('/').pop();
              sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.invitationMedia;
              sendMessageObj.type = 'media';
            }
            const response = await sendMessageFunc({...sendMessageObj,message: reply });

            const NewChatLog = await ChatLogs.findOneAndUpdate(
              {
                senderNumber: remoteId,
                instanceId: messageObject?.instance_id,
                eventId : campaign._id,
                messageTrack:  1
              },
              {
                $set: {
                  updatedAt: Date.now(),
                }
              },
              {
                upsert: true, // Create if not found, update if found
                new: true // Return the modified document rather than the original
              }
            )

            return res.send('invitemessageSend')

          } else if(codeType === campaign.acceptCode){

            let reply = campaign?.thankYouText+' 111'
            if(campaign?.thankYouMedia){              
              sendMessageObj.filename = campaign?.thankYouMedia.split('/').pop();
              sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.thankYouMedia;
              sendMessageObj.type = 'media';
            }
            
            previousChatLog.messageTrack = 3;
            previousChatLog.finalResponse = message;
            previousChatLog.inviteStatus = 'Accepted';
            previousChatLog.updatedAt= Date.now();

            senderId.lastResponse = message;
            senderId.lastResponseUpdatedAt= Date.now();
            senderId.inviteStatus ='Accepted';

            // console.log('previousChatLog',previousChatLog);
            await senderId.save();
            await previousChatLog.save(); 
            const response = await sendMessageFunc({...sendMessageObj,message: reply }); 
            return res.send('acceptmessageSend')

          } else if(codeType === campaign.rejectCode){
            previousChatLog['messageTrack']=3;
            previousChatLog['finalResponse']=message.toLowerCase();
            previousChatLog.inviteStatus = 'Rejected';
            previousChatLog.updatedAt= Date.now();

            if(campaign.verifyNumberFirst){
              senderId.lastResponse = message;
              senderId.lastResponseUpdatedAt= Date.now();
              senderId.inviteStatus ='Rejected';
              await senderId.save()
            }

            await previousChatLog.save()
            let reply = campaign?.messageForRejection
            const response = await sendMessageFunc({...sendMessageObj,message: reply }); 

            return res.send('rejectmessageSend')

          }else{
            return res.send('not a valid code')
          }
        }
        return res.send('nothing')
      }


      let reply;
      console.log('previousChatLog', previousChatLog)

    

      if(!previousChatLog){
        const campaignData = await Event.find({_id: recieverId.eventId})
        console.log({campaignData})
        for (let campaign of campaignData){
          let contact;
          if(campaign.verifyNumberFirst){
            contact = await Contact.findOne({number: remoteId})
            console.log({contact})
            if(!contact) {
              // reply = campaign.numberVerificationFails;
              // const response = await sendMessageFunc({...sendMessageObj,message: reply });
              return res.send('Account not found')
            }
          }
          if(campaign.startingKeyword.toLowerCase() === message.toLowerCase()){
            const currentTime = moment();
           
            const startingTime = moment(campaign.startDate)
            .set('hour', campaign.startHour)
            .set('minute', campaign.startMinute);
      
          const endingTime = moment(campaign.endDate)
            .set('hour', campaign.endHour)
            .set('minute', campaign.endMinute);

            if (!currentTime.isBetween(startingTime, endingTime)) {
              const response =  await sendMessageFunc({...sendMessageObj,message: campaign?.messageForClosedInvitations });
              return res.send(true);      
            }
            let reply = campaign?.invitationText
            if(campaign?.invitationMedia){              
              sendMessageObj.filename = campaign?.invitationMedia.split('/').pop();
              sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.invitationMedia;
              sendMessageObj.type = 'media';
            }
            const response = await sendMessageFunc({...sendMessageObj,message: reply });
            const NewChatLog = await ChatLogs.findOneAndUpdate(
              {
                senderNumber: remoteId,
                instanceId: messageObject?.instance_id,
                updatedAt: { $gte: start, $lt: end },
                eventId : campaign._id,
                messageTrack:  1
              },
              {
                $set: {
                  updatedAt: Date.now(),
                  isValid: contact? true: false
                }
              },
              {
                upsert: true, // Create if not found, update if found
                new: true // Return the modified document rather than the original
              }
            )
            return res.send('firstMessage sent')
          }
        }
        return res.send('No active campaign found')
       
      }

      const campaign = await Event.findOne({_id: previousChatLog?.eventId})

      if(campaign?.RewriteKeyword?.toLowerCase() === message?.toLowerCase()){
        if(!previousChatLog || previousChatLog.messageTrack===1){
          const response =  await sendMessageFunc({...sendMessageObj,message: 'Nothing to cancel' });
          return res.send(true);
        }
        previousChatLog['messageTrack']=1
        previousChatLog['finalResponse']=''
        previousChatLog['inviteStatus']='Pending'
        await previousChatLog.save()
        if(campaign?.verifyNumberFirst){
          senderId.lastResponse = '';
          senderId.lastResponseUpdatedAt= Date.now();
          senderId.inviteStatus ='Pending';
          senderId.save();
        }
        let reply = campaign?.invitationText
          if(campaign?.invitationMedia){              
            sendMessageObj.filename = campaign?.invitationMedia.split('/').pop();
            sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.invitationMedia;
            sendMessageObj.type = 'media';
          }
        const response =  await sendMessageFunc({...sendMessageObj,message: reply });
        return res.send('after change message')
      }

      if(campaign.startingKeyword.toLowerCase() === message.toLowerCase()){
        const currentTime = moment();
        
        const startingTime = moment(campaign.startDate)
        .set('hour', campaign.startHour)
        .set('minute', campaign.startMinute);
  
      const endingTime = moment(campaign.endDate)
        .set('hour', campaign.endHour)
        .set('minute', campaign.endMinute);

        if (!currentTime.isBetween(startingTime, endingTime)) {
          const response =  await sendMessageFunc({...sendMessageObj,message: campaign?.messageForClosedInvitations });
          return res.send(true);      
        }
        let reply = campaign?.invitationText
        if(campaign?.invitationMedia){              
          sendMessageObj.filename = campaign?.invitationMedia.split('/').pop();
          sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.invitationMedia;
          sendMessageObj.type = 'media';
        }
        const response = await sendMessageFunc({...sendMessageObj,message: reply });
        const NewChatLog = await ChatLogs.findOneAndUpdate(
          {
            senderNumber: remoteId,
            instanceId: messageObject?.instance_id,
            eventId : campaign._id,
          },
          {
            $set: {
              updatedAt: Date.now(),
              messageTrack:  1
            }
          },
          {
            upsert: true, // Create if not found, update if found
            new: true // Return the modified document rather than the original
          }
        )
        return res.send('firstMessage sent')
      }
      
      console.log({campaign})
      if(/\byes\b/i.test(message.trim())){
        if( previousChatLog?.finalResponse){
          const reply =`Your data is already saved . Type *${campaign.RewriteKeyword}* to edit your choice`
          const response = await sendMessageFunc({...sendMessageObj,message: reply });
          return res.send('Type Change First')
        }
        previousChatLog['messageTrack']=2;
        await previousChatLog.save()
        if(campaign?.verifyNumberFirst){
          const contact = await Contact.findOne({
            number: remoteId
          })
          console.log({contact})
          if(contact.invites!='1'){
            reply = campaign?.messageForMoreThanOneInvites
            const response = await sendMessageFunc({...sendMessageObj,message: reply });
            return res.send('More Invites')
          }else{
            let reply = campaign?.thankYouText+' 112'
            if(campaign?.thankYouMedia){              
              sendMessageObj.filename = campaign?.thankYouMedia.split('/').pop();
              sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.thankYouMedia;
              sendMessageObj.type = 'media';
            }
            
            previousChatLog.messageTrack = 3;
            previousChatLog.finalResponse = message;
            previousChatLog.inviteStatus = 'Accepted';
            previousChatLog.updatedAt= Date.now();

            senderId.lastResponse = message;
            senderId.lastResponseUpdatedAt= Date.now();
            senderId.inviteStatus ='Accepted';

            // console.log('previousChatLog',previousChatLog);
            await senderId.save();
            await previousChatLog.save(); 
          const response = await sendMessageFunc({...sendMessageObj,message: reply }); 
          return res.send('thank you send')
          }
        }else{
          let reply = campaign?.thankYouText+' 113'
          if(campaign?.thankYouMedia){              
            sendMessageObj.filename = campaign?.thankYouMedia.split('/').pop();
            sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.thankYouMedia;
            sendMessageObj.type = 'media';
          }
          previousChatLog.messageTrack = 3;
          previousChatLog.finalResponse = message;
          previousChatLog.inviteStatus = 'Accepted';
          previousChatLog.updatedAt= Date.now(),
          // console.log('previousChatLog',previousChatLog);
          await previousChatLog.save()
          const response = await sendMessageFunc({...sendMessageObj,message: reply }); 
          return res.send('thank you send')
        }
      }

      if(/\bno\b/i.test(message.trim())){
        if( previousChatLog?.finalResponse){
          const reply =`Your data is already saved . Type *${campaign.RewriteKeyword}* to edit your choice`
          const response = await sendMessageFunc({...sendMessageObj,message: reply });
          return res.send('Type Change First')
        }

        previousChatLog['messageTrack']=3;
        previousChatLog['finalResponse']=message.toLowerCase();
        previousChatLog.inviteStatus = 'Rejected';
        previousChatLog.updatedAt= Date.now();

        if(campaign.verifyNumberFirst){
          senderId.lastResponse = message;
          senderId.lastResponseUpdatedAt= Date.now();
          senderId.inviteStatus ='Rejected';
          await senderId.save()
        }

        await previousChatLog.save()
        let reply = campaign?.messageForRejection
        const response = await sendMessageFunc({...sendMessageObj,message: reply }); 
        return res.send('rejection send')
      }

      if(campaign?.verifyNumberFirst){
        const contact = await Contact.findOne({number: remoteId})
        if(previousChatLog?.messageTrack===2){
          if(message.toLowerCase()===contact.invites.toLowerCase() || (!isNaN(message) && +message < contact.invites || 5)){
            
            let reply = campaign?.thankYouText+' 114'
            if(campaign?.thankYouMedia){              
              sendMessageObj.filename = campaign?.thankYouMedia.split('/').pop();
              sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.thankYouMedia;
              sendMessageObj.type = 'media';
            }

            previousChatLog.messageTrack = 3;
            previousChatLog.finalResponse=message;
            previousChatLog.updatedAt=Date.now();
            previousChatLog.inviteStatus = 'Accepted';
            // console.log('previousChatLog',previousChatLog);
            await previousChatLog.save(); 
    
            senderId.lastResponse = message;
            senderId.lastResponseUpdatedAt= Date.now();
            senderId.inviteStatus ='Accepted';
            await senderId.save()

            const response = await sendMessageFunc({...sendMessageObj,message: reply }); 
            return res.send('thank you send')
          }else{
            const response = await sendMessageFunc({...sendMessageObj,message: 'Invalid Input' }); 
            return res.send('Invalid Input')
          }
        }
      }

      if(campaign?.RewriteKeyword?.toLowerCase() === message?.toLowerCase()){
        if(!previousChatLog || previousChatLog.messageTrack===1){
          const response =  await sendMessageFunc({...sendMessageObj,message: 'Nothing to cancel' });
          return res.send(true);
        }
        previousChatLog['messageTrack']=1
        previousChatLog['finalResponse']=''
        await previousChatLog.save()
        let reply = campaign?.invitationText
          if(campaign?.invitationMedia){              
            sendMessageObj.filename = campaign?.invitationMedia.split('/').pop();
            sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.invitationMedia;
            sendMessageObj.type = 'media';
          }
        const response =  await sendMessageFunc({...sendMessageObj,message: reply });
        return res.send('after change message')
      }
      
      return res.send('nothing matched')
    }else if(["messages.update"].includes(req.body?.data?.event)){
      
      let data = messageObject.data.data
      for (const elem of data) {
        let messageId = elem.key?.id;
        let message = await Message.findOne({ messageId });
        console.log('messageFound');
        if (!message) {
          console.log('messageNotFound');
          continue;
        };
    
        let newStatus = {
          status: elem.update?.status,  // Replace with the actual status name
          time: new Date()            // Set the actual time or use a specific date
        };
    
        message.messageStatus.push(newStatus);
        await message.save();
        console.log('message status Updated to '+ elem.update?.status+' for '+ message.text)
      }
      return res.send('status updated')
    }
    
    else{
      return res.send(false)
    }
  }catch (error){
    console.log(error)
    return res.status(500).json({ error: 'Internal server error' });
  }
}


const sendMessageFunc = async (message, data={})=>{
  console.log(message)
  // const chatLog = await ChatLogs.findOne({
  //   senderNumber: message.number,
  //   instanceId: message.instance_id
  // }).sort({ updatedAt: -1 })
  
  const contact = await Contact.findOne({number: message.number});

  message.message = reformText(message?.message, {contact})
  
  const url = process.env.LOGIN_CB_API
  const access_token = process.env.ACCESS_TOKEN_CB
  if(message?.media_url){
    const newMessage = {
      ...message,
      senderNumber: message?.number,
      instanceId: message?.instance_id,
      fromMe: true,
      text: message?.message,
      media_url: message?.media_url
    }
    const savedMessage = new Message(newMessage);
    await savedMessage.save();
  }

  // console.log('aaaa',newMessage)

  const response = await axios.get(`${url}/send`,{params:{...message,access_token}})
  console.log(response)
  return true;
}

const reformText = (message, data)=>{
  const {contact, chatLog} = data;
  
  let mergedContact = {};
  
  if(contact){
    mergedContact = {...contact?.toObject()};
  }

  if(chatLog?.otherMessages){
    Object.entries(chatLog?.otherMessages).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        if (value?.name !== undefined) {
          mergedContact[key] = value.name;
        } else if (value.value !== undefined) {
          mergedContact[key] = value.value;
        }
      }
    });
  }

  function replacePlaceholders(message, data) {
    return message.replace(/{(\w+)}/g, (_, key) => data[key] || `{${key}}`);
  }
  
  return replacePlaceholders(message, mergedContact);
  
}


const getReport = async (req, res) => {
  const { fromDate, toDate } = req.query;
  let startDate, endDate;

  if (fromDate && toDate) {
    startDate = new Date(fromDate);
    endDate = new Date(toDate);
  }

  let dateFilter = {};
  if (startDate && endDate) { // If both startDate and endDate are defined, add a date range filter
    dateFilter = {
      "updatedAt": {
        $gte: startDate,
        $lt: endDate
      }
    };
  }

  let query = [
    {
      $lookup: {
        from: 'chatlogs',
        let: { contactITS: '$ITS' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$requestedITS', '$$contactITS'] },
                  { $eq: ['$instance_id', req.params.id] },
                  { $gte: ['$updatedAt', startDate] },
                  { $lt: ['$updatedAt', endDate] }
                ]
              }
            }
          }
        ],
        as: 'chatlog'
      }
    },
    { $unwind: { path: '$chatlog', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        PhoneNumber: { $toString: '$number' }  // Assuming `number` is directly in contacts
      }
    },
    {
      $project: {
        _id: 0,
        ITS: '$ITS',
        Name: '$name',
        PhoneNumber: 1,
        updatedAt: '$chatlog.updatedAt',
        Status: '$chatlog.messageTrack',
        Venue: '$chatlog.otherMessages.venue',
        Response: '$chatlog.otherMessages.profile'
      }
    }
  ];

  try {

const formatDate = (date) => {
      if (!date || isNaN(new Date(date).getTime())) {
        return ''; // Return blank if date is invalid
      }
      const options = { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: true 
      };
      return new Date(date).toLocaleString('en-US', options).replace(',', '');
    };

    let data = await Contact.aggregate(query);
    data = data.map(ele=>({
      ...ele,
      'updatedAt': formatDate(ele.updatedAt),
      Venue: getNames('venue', ele?.Venue),
      Response: getNames('profile', ele?.Response),
    }))

    const fileName = `Report-${Date.now()}.csv`
    const filePath = `uploads/reports/${fileName}`;
    const csvWriter = createCsvWriter({
      path: filePath,
      header: [
        { id: 'Name', title: 'Name' },
        { id: 'PhoneNumber', title: 'PhoneNumber' },
        { id: 'ITS', title: 'ITS' },
        { id: 'updatedAt', title: 'Updated At' },
        { id: 'Venue', title: 'Venue' },
        { id: 'Response', title: 'Response' },
        { id: 'Status', title: 'Status' },
      ]
    });

    await csvWriter.writeRecords(data);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
};


async function getReportdataByTime(startDate, endDate, id) {
  let dateFilter = {};
  if (startDate && endDate) {
    dateFilter = {
      "updatedAt": {
        $gte: new Date(startDate),
        $lt: new Date(endDate)
      }
    };
  }

  console.log('instance', id)
  let query = [
    {
      $match: { instanceId: id.toString() }
    },
    {
      $lookup: {
        from: 'chatlogs',
        let: { contactNumber: '$number' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$senderNumber', '$$contactNumber'] },
                ]
              }
            }
          }
        ],
        as: 'chatlog'
      }
    },
    { $unwind: { path: '$chatlog', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        finalResponse: '$chatlog.finalResponse',
        'UpdatedAt': '$chatlog.updatedAt',
      }
    },
    {
      $project: {
        _id: 0,
        Name: '$name',
        PhoneNumber: { $toString: '$number' },
        invites: '$invites',
        'UpdatedAt': 1,
        Status: 1,
        finalResponse: 1
      }
    }
  ];

  try {
    const formatDate = (date) => {
      if (!date || isNaN(new Date(date).getTime())) {
        return ''; // Return blank if date is invalid
      }
      const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      };
      return new Date(date).toLocaleString('en-US', options).replace(',', '');
    };

    let data = await Contact.aggregate(query);

    console.log(data)

    data = data.map(ele => ({
      Name: ele.Name,
      PhoneNumber: ele.PhoneNumber,
      invites: ele.invites,
      'Updated At': formatDate(ele['UpdatedAt']),
      Status: ele.finalResponse ? /\bno\b/i.test(ele.finalResponse) ?'Rejected':'Accepted':'Pending',
      finalResponse: ele.finalResponse
    }));

    const fileName = `Report-${Date.now()}.xlsx`;
    const filePath = `uploads/reports/${fileName}`;
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Report');
    xlsx.writeFile(wb, filePath);

    console.log(`XLSX file created successfully at ${filePath}`);

    return filePath;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function createPDF(data, filePath) {
  console.log('data',data)
  console.log('filepath',filePath)
 
  const templateSource = fs.readFileSync(`${process.cwd()}/uploads/reports/template.hbs`, 'utf8');
  const template = handlebars.compile(templateSource);
  // Register a helper to increment index
  handlebars.registerHelper('inc', function(value, options) {
    return parseInt(value) + 1;
  });
  const html = template({ records: data });
       
  const options = {
    format: 'A4',
    border: {
      top: '15px',
      right: '10px',
      bottom: '15px',
      left: '10px'
    }
  };
  return new Promise((resolve, reject) => {
    pdf.create(html, options).toFile(`${process.cwd()}${filePath}`, function (err, res) {
      if (err) {
        console.error(err);
        return reject(err);
      }
      console.log('PDF created successfully');
      resolve(res);
    });
  });
}


async function getStats1(eventId, instanceId, startDate, endDate) {
  let dateFilter = {};
  if (startDate && endDate) {
    dateFilter = {
      updatedAt: {
        $gte: new Date(startDate),
        $lt: new Date(endDate)
      }
    };
  }

  const noRegex = /\bno\b/i;

  console.log('ssssssssssss',eventId, instanceId, startDate, endDate)
  
  try {
    const [chatLogsStats, uniqueContacts, totalContacts] = await Promise.all([
      ChatLogs.aggregate([
        {
          $match: {
            instanceId: instanceId.instance_id,
            eventId: eventId.toString()
          }
        },
        {
          $facet: {
            totalEntries: [{ $count: "count" }],
            totalYesResponses: [
              { $match: { finalResponse: { $not: noRegex, $nin: [null, ''] } } },
              { $count: "count" }
            ],
            totalNoResponses: [
              { $match: { finalResponse: {$regex: noRegex }} },
              { $count: "count" }
            ]
          }
        }
      ]).then(result => result[0]),

      Contact.aggregate([
        {
          $group: {
            _id: '$number',
            uniqueContacts: { $first: '$$ROOT' }
          }
        },
        {
          $lookup: {
            from: 'chatlogs',
            let: { contactNumber: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$senderNumber', '$$contactNumber'] },
                      { $eq: ['$instanceId', instanceId._id.toString()] },
                    ].filter(Boolean) // Remove empty objects
                  }
                }
              }
            ],
            as: 'chatlog'
          }
        },
        { $match: { eventId: eventId.toString(), 'chatlog.0': { $exists: true } } }
      ]),

      Contact.aggregate([
        { $match : { eventId: eventId.toString()}},
        {
          $group: {
            _id: '$number'
          }
        },
        {
          $count: 'totalContacts'
        }
      ]).then(result => (result[0] ? result[0].totalContacts : 0))
    ]);

    console.log({chatLogsStats, uniqueContacts, totalContacts})
    const totalEntries = chatLogsStats.totalEntries[0] ? chatLogsStats.totalEntries[0].count : 0;
    const totalYesResponses = chatLogsStats.totalYesResponses[0] ? chatLogsStats.totalYesResponses[0].count : 0;
    const totalNoResponses = chatLogsStats.totalNoResponses[0] ? chatLogsStats.totalNoResponses[0].count : 0;
    const totalUnresponsiveContacts = totalContacts - ( totalYesResponses + totalNoResponses);

    console.log(
{     totalContacts, 
      totalEntries,
      totalYesResponses,
      totalNoResponses,
      totalUnresponsiveContacts}
    )

    return {
      totalContacts,
      yes: totalYesResponses,
      no: totalNoResponses,
      balance: totalUnresponsiveContacts
    };
  } catch (error) {
    console.error('Error getting stats:', error);
    throw error; // Ensure errors are thrown to be handled by the calling function
  }
}

const fetchDashBoardStats = async(req, res)=>{
  const {eventId, instance_id} = req.body
  const instance = await Instance.findOne({_id:instance_id})
  const statsBody = await getStats1(eventId, instance, '','')
  return res.send(statsBody)
}

module.exports = {
  saveContact,
  getContact,
  updateContacts,
  getMessages,
  sendMessages,
  recieveMessagesV2,
  getReport,
  saveContactsInBulk,
  sendBulkMessage,
  fetchDashBoardStats
};
