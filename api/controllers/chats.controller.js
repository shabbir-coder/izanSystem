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
      contact.campaignId = req.body.campaignId || null;
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
      const { page, limit, searchtext, campaignId} = req.query;
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

const sendBulkMessage = async (req, res)=>{
  try {

    const { instance_id, eventId, messageTrack } = req.body;

    const senderId = req.user.userId
    const instance = await Instance.findOne({_id:instance_id})
    // Save the message to the database
    let start = new Date();
    start.setHours(0,0,0,0);

    let end = new Date();
    end.setHours(23,59,59,999);
    const campaign = await Event.findOne({_id: eventId})

    const contacts = await Contact.find({ eventId: eventId });

    for(let contact of contacts){

      const number = contact.number;

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
            updatedAt: { $gte: start, $lt: end },
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
        await new Promise(resolve => setTimeout(resolve, 8000));
      }
    }

    // console.log('response', response.data)
    
    return res.status(201).send({message:'mesg sent'});
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.data });
  }
}

const sendMessages = async (req, res)=>{
  try {

    const { numbers, instance_id, eventId, messageTrack } = req.body;

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
            updatedAt: { $gte: start, $lt: end },
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
      }
    }

    // console.log('response', response.data)
    
    return res.status(201).send({message:'mesg sent'});
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.data });
  }
}

const recieveMessages1 = async (req, res)=>{
  try {
    // const io = getIO();
    const activeSet = await getCachedData(dataKey)
    const messageObject = req.body;
    const venueNames = ['Saifee Masjid','Burhani Masjid','MM Warqa']
    const khidmatNames = ['For all Majlis and Miqaat','Only During Ramadan','Only During Ashara','Only During Ramadan and Ashara']
    if(messageObject.data?.data?.messages?.[0]?.key?.fromMe === true) return res.send()
    if(["messages.upsert"].includes(req.body?.data?.event)){
      // console.log(messageObject.data.data.messages?.[0]?.message)
      let message;
      const currentTime = moment();
      const startingTime = moment(activeSet?.StartingTime);
      const endingTime = moment(activeSet?.EndingTime);

      message = messageObject.data.data.messages?.[0]?.message?.extendedTextMessage?.text || messageObject.data.data.messages?.[0]?.message?.conversation || '';
      let remoteId = messageObject.data.data.messages?.[0]?.key.remoteJid.split('@')[0];
      const senderId = await Contact.findOne({number: remoteId})
      
      const recieverId = await Instance.findOne({instance_id: messageObject.instance_id})
      const newMessage = {
        recieverId : recieverId?._id,
        senderId: senderId?._id,
        instance_id: messageObject?.instance_id,
        text: message,
        type: 'text'
      }
      const savedMessage = new Message(newMessage);
      await savedMessage.save();
      const sendMessageObj={
        number: remoteId,
        type: 'text',
        instance_id: messageObject?.instance_id,
      }
      
      if (!currentTime.isBetween(startingTime, endingTime)) {
        const response =  await sendMessageFunc({...sendMessageObj,message: "Registrations are closed now" });
        return res.send(true);      
      }
    
      let start = new Date();
      start.setHours(0,0,0,0);

      let end = new Date();
      end.setHours(23,59,59,999);

      if(['report','reports'].includes(message.toLowerCase()) && senderId?.isAdmin){
        if(!senderId?.isAdmin){
          const response =  await sendMessageFunc({...sendMessageObj, message: 'Invalid Input' });
          return res.send(true);
        }
        const fileName = await getReportdataByTime(start,end, messageObject?.instance_id)
        // const fileName = 'http://5.189.156.200:84/uploads/reports/Report-1716394369435.csv'
        sendMessageObj.filename = fileName.split('/').pop();
        sendMessageObj.media_url= process.env.IMAGE_URL+fileName;
        sendMessageObj.type = 'media';
        const response =  await sendMessageFunc({...sendMessageObj, message:'Download report'});
        return res.send(true);
      }

      if(['stats','statistics'].includes(message.toLowerCase()) && senderId?.isAdmin){
        if(!senderId?.isAdmin){
          const response =  await sendMessageFunc({...sendMessageObj, message: 'Invalid Input' });
          return res.send(true);
        }

        const replyObj = await getStats1(messageObject?.instance_id,'','');
        const formattedStart = moment(activeSet?.StartingTime).format('DD-MM-YYYY');
        const formattedEnd = moment(activeSet?.EndingTime).format('DD-MM-YYYY');

        let replyMessage = '*Statistics*';
        replyMessage += '\n\n';
        replyMessage += `\n● Start of Campaign *${formattedStart}*`;
        replyMessage += `\n● End of Campaign *${formattedEnd}*`;
        replyMessage += `\n● Total nos of entries *${replyObj?.totalContacts}*`;
        replyMessage += `\n● Total nos updated responses *${replyObj?.totalCompletedResponses}*`;
        replyMessage += `\n● Total nos of incomplete responses *${replyObj?.totalIncompleteResponses}*`;
        replyMessage += `\n● Total nos of unresponsive *${replyObj?.totalUnresponsiveContacts}*`;
        
        const response = await sendMessageFunc({...sendMessageObj, message: replyMessage});
        return res.send(true);
      }
      
      if(!senderId) {
        if(message.toLowerCase() === activeSet?.EntryPoint.toLowerCase()){
          const response =  await sendMessageFunc({...sendMessageObj,message: 'Whatsapp Number not found on Anjuman Najmi Profile'});
          return res.send({message:'Account not found'});
        } else {
          return res.send({message:'Account not found'});
        }
      }

      if(message.toLowerCase() === activeSet?.EntryPoint.toLowerCase()){
        const response =  await sendMessageFunc({...sendMessageObj,message: activeSet.NumberVerifiedMessage });
        senderId.isVerified = true
        await senderId.save()
        return res.send(true)

      } else if ( senderId?.isVerified && /^\d{8}$/.test(message)){
        const ITSmatched = await Contact.findOne({number: remoteId, ITS:message})
        let responseText= '';
        const NewChatLog = await ChatLogs.findOneAndUpdate(
          {
            senderId: senderId?._id,
            instance_id: messageObject?.instance_id,
            requestedITS: message, // Ensure there is a registeredId
            updatedAt: { $gte: start, $lt: end } // Documents updated today
          },
          {
            $set: {
              updatedAt: Date.now(),
              isValid: ITSmatched? true: false
            }
          },
          {
            upsert: true, // Create if not found, update if found
            new: true // Return the modified document rather than the original
          }
        )
        if(ITSmatched){
           
            const izanDate = new Date(ITSmatched.lastIzantaken)
            console.log(izanDate >= start && izanDate <= end,{izanDate}, {start} , {end})
            if( izanDate >= start && izanDate <= end){
              console.log('saving from here')
              const response = await sendMessageFunc({...sendMessageObj,message:'Already registered. Type Change to edit the selected choice.' });
              return res.send(true)
            }
      
          responseText = activeSet.ITSverificationMessage.replace('${name}', ITSmatched.name );
            const chatLog = await ChatLogs.findOne(
              {
                  senderId: senderId?._id,
                  instance_id: messageObject?.instance_id,
                  updatedAt: { $gte: start, $lt: end }
              }
            ).sort({ updatedAt: -1 });

            chatLog.updatedAt = Date.now();
            chatLog.messageTrack = 'venue';
            await chatLog.save();
        } else {
          responseText = activeSet.ITSverificationFailed;
        }
        const response = await sendMessageFunc({...sendMessageObj,message: responseText});
        return res.send(true);

      } else if (senderId.isVerified && /^\d{4,7}$/.test(message)){
        const response =  await sendMessageFunc({...sendMessageObj,message: 'Incorrect ITS, Please enter valid ITS only' });
        return res.send(true)
      } else if (senderId.isVerified && /^\d{2,3}$/.test(message)){
        const response =  await sendMessageFunc({...sendMessageObj,message: 'Incorrect ITS, Please enter valid ITS only' });
        return res.send(true)
      } else if (senderId.isVerified && (message.match(/\n/g) || []).length !== 0){
        const response =  await sendMessageFunc({...sendMessageObj,message: 'Invalid Input' });
        return res.send(true)
      } else {
        if(!senderId.isVerified) return res.send(true);
        const latestChatLog = await ChatLogs.findOne(
          {
              senderId: senderId?._id,
              instance_id: messageObject?.instance_id,
              updatedAt: { $gte: start, $lt: end }
          }
        ).sort({ updatedAt: -1 });

        if(!latestChatLog?.isValid){
          const response =  await sendMessageFunc({...sendMessageObj,message: 'Please enter valid ITS first' });
          return res.send(true);
        }

        const messages = Object.values(latestChatLog?.otherMessages || {});
        const requestedITS = await Contact.findOne({number: remoteId, ITS: latestChatLog?.requestedITS})
          
        const izanDate = new Date(requestedITS?.lastIzantaken)

        if( izanDate >= start && izanDate <= end && !['cancel','change'].includes(message.toLowerCase())){
          if((latestChatLog.messageTrack === 'venue' && (isNaN(message) || +message > venueNames.length)) ||
          (latestChatLog.messageTrack === 'profile' && (isNaN(message) || +message > khidmatNames.length))){
            const response = await sendMessageFunc({...sendMessageObj,message:'Invalid Input' });
            return res.send(true)    
          }
          const response = await sendMessageFunc({...sendMessageObj,message:'Already registered. Type Change to edit the selected choice.' });
          return res.send(true)
        }
        if(['cancel','change'].includes(message.toLowerCase())){

          const latestChatLog = await ChatLogs.findOne(
            {
                senderId: senderId?._id,
                instance_id: messageObject?.instance_id,
                updatedAt: { $gte: start, $lt: end }
            }
          ).sort({ updatedAt: -1 });
          // let lastKeyToDelete = null;
          if(!latestChatLog){
            const response =  await sendMessageFunc({...sendMessageObj,message: 'Nothing to cancel' });
            return res.send(true);
          }
          // for (const [key, value] of Object.entries(latestChatLog?.otherMessages)) {
          //   if (!isNaN(value)) {
          //     lastKeyToDelete = key;
          //   }
          // }
          
          const update = { $unset: { [`otherMessages`]: "" }, $set: {messageTrack:'venue', updatedAt: Date.now() }
          };
          await ChatLogs.updateOne({ _id: latestChatLog?._id }, update);
          

          const ITSmatched = await Contact.findOne({ITS: latestChatLog.requestedITS});
          ITSmatched.lastIzantaken=null
          await ITSmatched.save()

          const response =  await sendMessageFunc({...sendMessageObj,message: activeSet?.ITSverificationMessage.replace('${name}', ITSmatched.name )});
          return res.send(true);
        }

        if (
          (latestChatLog.messageTrack === 'venue' && (isNaN(message) || +message > venueNames.length)) ||
          (latestChatLog.messageTrack === 'profile' && (isNaN(message) || +message > khidmatNames.length))
        ){
          const response = await sendMessageFunc({...sendMessageObj, message: 'Incorrect input. \nPlease enter corresponding number against each option only'} );
          return res.send(true);
        }
        
        let reply = processUserMessage(message, activeSet);
        console.log({latestChatLog})
        if(latestChatLog?.requestedITS && latestChatLog.messageTrack === 'profile'){
          reply = {message : activeSet?.AcceptanceMessage}
          reply.message = reply.message
            .replace('${name}', requestedITS?.name)
            .replace('${ans1}', venueNames[+latestChatLog.otherMessages['venue']-1])
            .replace('${ans2}', khidmatNames[+message-1]);
        }
        if(latestChatLog?.requestedITS && reply?.message) {
          if(latestChatLog.messageTrack === 'profile'){
            const ITSmatched = await Contact.findOne({ITS: latestChatLog?.requestedITS});
            ITSmatched.lastIzantaken = new Date();
            ITSmatched.save()
          }
          // console.log('reply', reply)
          const response = await sendMessageFunc({...sendMessageObj,message:reply?.message });

          // const messages = Object.values(latestChatLog?.otherMessages || {});
          // const isMessagePresent = messages.includes(message.toLowerCase());
          // if (isMessagePresent) {
          //     // If the message is already present, do not update and return
          //     console.log('i am stuck')
          //     return latestChatLog;
          // }

          let messageCount = latestChatLog?.otherMessages ? Object.keys(latestChatLog?.otherMessages).length : 0;
          messageCount++;

          const keyName = `${latestChatLog.messageTrack}`;
          const updateFields = { [`otherMessages.${keyName}`]: message.toLowerCase() , updatedAt: Date.now()} ;
          if(latestChatLog.messageTrack === 'venue'){
            updateFields['messageTrack']='profile'
          }else if(latestChatLog.messageTrack === 'profile'){
            updateFields['messageTrack']='submitted'
          }
          await ChatLogs.findOneAndUpdate(
            {
                senderId: senderId?._id,
                instance_id: messageObject?.instance_id,
                updatedAt: { $gte: start, $lt: end }
            },
            {$set : updateFields},
            { 
                new: true,
                sort: { updatedAt: -1 }
            }
          );
  
          return res.send(true);
        }
        const response = await sendMessageFunc({...sendMessageObj,message:'Invalid Input' });
        return res.send(true);
      }
    }else{
      return res.send(true);
    }
    // Save the message to the database

    // // Emit the message to all clients in the conversation room

  } catch (error) {
    console.error(error);

    res.status(500).json({ error: 'Internal server error' });
  } 
}


const recieveMessages = async (req, res)=>{
  try {
    const messageObject = req.body;
    if(messageObject.data?.data?.messages?.[0]?.key?.fromMe === true) return res.send()
    if(["messages.upsert"].includes(req.body?.data?.event)){
      let message;
      message = messageObject.data.data.messages?.[0]?.message?.extendedTextMessage?.text || messageObject.data.data.messages?.[0]?.message?.conversation || '';
      let remoteId = messageObject.data.data.messages?.[0]?.key.remoteJid.split('@')[0];

      if(remoteId.length>13){
        return res.send('invalid number')
      }

      let file = messageObject.data.data.messages[0].message?.imageMessage || messageObject.data.data.messages[0].message?.documentMessage || messageObject.data.data.messages[0].message?.audioMessage

      if(file){
        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir);
        }
        const mediaUrl = file.jpegThumbnail;
        const mimetype = file.mimetype;

        // await downloadAndSaveMedia(mediaUrl, mimetype, uploadsDir)
        // .then((savedPath) => {
        //   console.log('Media downloaded and saved successfully:', savedPath);
        // })
        // .catch((error) => {
        //   console.error('Error downloading and saving media:', error);
        // });
      }

      let start = new Date();
      start.setHours(0,0,0,0);

      let end = new Date();
      end.setHours(23,59,59,999);

      const recieverId = await Instance.findOne({instance_id: messageObject.instance_id})
      console.log({recieverId})

      const newMessage = {
        recieverId : recieverId?._id,
        senderNumber: remoteId,
        instanceId: messageObject?.instance_id,
        fromMe: false,
        text: message,
        type: 'text'
      }
      const savedMessage = new Message(newMessage);
      await savedMessage.save();
      const sendMessageObj={
        number: remoteId,
        type: 'text',
        instance_id: messageObject?.instance_id,
      }

      const previousChatLog = await ChatLogs.findOne(
        {
          senderNumber: remoteId,
          instanceId: messageObject?.instance_id,
          updatedAt: { $gte: start, $lt: end }
        },
      ).sort({ updatedAt: -1 });

      let reply;
      console.log('previousChatLog', previousChatLog)

      if(!previousChatLog){
        const campaignData = await Campaign.find({_id: recieverId.campaignId})
        console.log({campaignData})
        for (let campaign of campaignData){
          let contact;
          if(campaign.verifyNumberFirst){
            contact = await Contact.findOne({number: remoteId})
            console.log({contact})
            if(!contact) {
              reply = campaign.numberVerificationFails;
              const response = await sendMessageFunc({...sendMessageObj,message: reply });
              return res.send('Account not found')
            }
          }
          if(campaign.startingKeyword.toLowerCase() === message.toLowerCase()){
            reply = campaign.numberVerificationPasses;

            const currentTime = moment();
            // const startingTime = moment(campaign?.startDate);
            // const endingTime = moment(campaign?.endDate);
            const startingTime = moment(campaign.startDate)
            .set('hour', campaign.startHour)
            .set('minute', campaign.startMinute);
      
          const endingTime = moment(campaign.endDate)
            .set('hour', campaign.endHour)
            .set('minute', campaign.endMinute);

            if (!currentTime.isBetween(startingTime, endingTime)) {
              const response =  await sendMessageFunc({...sendMessageObj,message: "Registrations are closed now" });
              return res.send(true);      
            }

            const response = await sendMessageFunc({...sendMessageObj,message: reply });
            const NewChatLog = await ChatLogs.findOneAndUpdate(
              {
                senderNumber: remoteId,
                instanceId: messageObject?.instance_id,
                updatedAt: { $gte: start, $lt: end },
                campaignId : campaign._id,
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
      const activeCampaign = await Campaign.findOne({_id: previousChatLog.campaignId})
      console.log({activeCampaign})
      const currentTime = moment();
      // const startingTime = moment(activeCampaign?.startDate);
      // const endingTime = moment(activeCampaign?.endDate);

      const startingTime = moment(activeCampaign.startDate)
      .set('hour', activeCampaign.startHour)
      .set('minute', activeCampaign.startMinute);

    const endingTime = moment(activeCampaign.endDate)
      .set('hour', activeCampaign.endHour)
      .set('minute', activeCampaign.endMinute);

      console.log({currentTime, startingTime, endingTime})
      if (!currentTime.isBetween(startingTime, endingTime)) {
        const response =  await sendMessageFunc({...sendMessageObj,message: "Registrations are closed now 2" });
        return res.send(true);      
      }

      if(activeCampaign.startingKeyword.toLowerCase() === message.toLowerCase()){
        reply = activeCampaign.numberVerificationPasses;
        const response = await sendMessageFunc({...sendMessageObj,message: reply });
        return res.send('start msg sent')
      }

      if(activeCampaign?.entryRewriteKeyword?.toLowerCase() === message?.toLowerCase()){
        if(!previousChatLog || previousChatLog.messageTrack===1){
          const response =  await sendMessageFunc({...sendMessageObj,message: 'Nothing to cancel' });
          return res.send(true);
        }
        // for (const [key, value] of Object.entries(latestChatLog?.otherMessages)) {
        //   if (!isNaN(value)) {
        //     lastKeyToDelete = key;
        //   }
        // }
        previousChatLog['messageTrack']=2
        previousChatLog['sequenceTrack']=1
        previousChatLog['otherMessages']={}
        await previousChatLog.save()
        const currentSequence = activeCampaign.sequences[0];
        const reply = currentSequence.messageText;
        const response =  await sendMessageFunc({...sendMessageObj,message: reply });
        return res.send('after change message')

      }

      let resValue = 'start';
      console.log('previousChatLog', previousChatLog)
// || (previousChatLog?.senderCode && previousChatLog?.senderCode != message)
      if(previousChatLog.messageTrack === 1 && activeCampaign?.verifyUserCode){
        console.log('I am here============')
        const { codeType, codeLength } = activeCampaign;
        let pattern;
        resValue += ' 1'
        switch (codeType) {
          case 'Numbers':
            pattern = new RegExp(`^[0-9]{${codeLength}}$`);
            break;
          case 'Alphanumerical':
            pattern = new RegExp(`^[a-zA-Z0-9]{${codeLength}}$`);
            break;
          case 'Alphabets':
            pattern = new RegExp(`^[a-zA-Z]{${codeLength}}$`);
            break;
          default:
            return res.status(400).json({ message: 'Invalid code type' });
        }
        if (!pattern.test(message)) {
          const reply = 'Invalid Code Input';
          const response =  await sendMessageFunc({...sendMessageObj,message: reply });
          return res.send('not matched with pattern')
        }else{
          resValue += ' 2'
          const matchedContact = await Contact.findOne({code: message, number: remoteId})
          console.log('matchedContact', matchedContact)
          if(!matchedContact){
            reply = activeCampaign.numberVerificationFails;
            const response = await sendMessageFunc({...sendMessageObj,message: reply });
            return res.send('Account not found')
          }
         const findChatLogByCode = await ChatLogs.findOne(
            {
              senderNumber: remoteId,
              senderCode: message,
              instanceId: messageObject?.instance_id,
              updatedAt: { $gte: start, $lt: end }
            },
          ).sort({ updatedAt: -1 });

          const currentSequence = activeCampaign.sequences[findChatLogByCode?.sequenceTrack];
          if(findChatLogByCode && !currentSequence){
            const reply = `Your response has been already been saved 2. Type "${activeCampaign.entryRewriteKeyword} to change your entry`;
            const response =  await sendMessageFunc({...sendMessageObj,message: reply });
            return res.send('Response is saved')    
          }
        
          if(!matchedContact){
            resValue += ' 3'
            const reply = activeCampaign?.codeVerificationFails;
            const response =  await sendMessageFunc({...sendMessageObj,message: reply });
            return res.send('contact not found')
          }else{
            resValue += ' 4'
            if(findChatLogByCode){
              resValue += ' 5'
              findChatLogByCode['messageTrack']=2;
              findChatLogByCode['updatedAt']= Date.now(),

              await findChatLogByCode.save();
              return res.send('old code re edited')
            }else{
              resValue += ' 6'
              previousChatLog['senderCode'] = message;
            }
          }
        }

      }
      console.log('aaaaaa', resValue);
      if((activeCampaign.verifyUserCode && previousChatLog.messageTrack >= 1) || !activeCampaign.verifyUserCode ){
        // console.log({previousChatLog})

        console.log('ppppppppp');
        const currentSequence = activeCampaign.sequences[previousChatLog.sequenceTrack];
        if(!currentSequence){
          const reply = `Your response has been already been saved. Type "${activeCampaign.entryRewriteKeyword}" to change your entry.`
          const response =  await sendMessageFunc({...sendMessageObj,message: reply });
          return res.send('response saved')
        }
        const reply = currentSequence?.messageText;
        // console.log('currentSequence', currentSequence);
        previousChatLog['messageTrack']++;
        previousChatLog['sequenceTrack']++;
        previousChatLog['updatedAt']= Date.now();
        // console.log('currentSequence', currentSequence);
        // console.log('previousChatLog', previousChatLog);
        let resvalue = 'before';
        if(previousChatLog?.sequenceTrack>0){
          // console.log({previousChatLog})
          resvalue += ' 1';
          const previousSequence = activeCampaign.sequences[previousChatLog.sequenceTrack-2]; 
          console.log('previousSequence', previousSequence);
          if(previousSequence?.type === 'options' && previousSequence.options.split(',').length < parseInt(message)||isNaN(message)){
            resvalue += ' 2';
            const response =  await sendMessageFunc({...sendMessageObj,message: 'Invalid Option' });
            return res.send('invalid option')
          }
          if(previousSequence?.saveInReport){
            resvalue += ' 3';
            const key =  previousSequence.reportVariable
            let saveDataObj = {[key]:{value:message}}
            if(previousSequence?.type === 'options'){
              resvalue += ' 4';
              let optionName = previousSequence.options.split(',')[parseInt(message)-1];
              saveDataObj = { [key]: { value: message, name: optionName } };
            }
            resvalue += ' 5';
            previousChatLog['otherMessages']={
              ...previousChatLog['otherMessages'],
              [key] : saveDataObj[key]
            }
          }
          resvalue += ' 6';

        }

        console.log('saving chatlog', previousChatLog);
        // return res.send('currentSequence previousChatLog')
        await previousChatLog.save();

        const response =  await sendMessageFunc({...sendMessageObj,message: reply });
        return res.send('first sequence message')
      }

      console.log({activeCampaign})
      return res.send('active22');

    }else{
      return res.send('true last');
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

const recieveMessagesV2 = async (req, res)=>{
  try{
    const messageObject = req.body;
    if(messageObject.data?.data?.messages?.[0]?.key?.fromMe === true) return res.send()
    if(["messages.upsert"].includes(req.body?.data?.event)){
      let message;
      message = messageObject.data.data.messages?.[0]?.message?.extendedTextMessage?.text || messageObject.data.data.messages?.[0]?.message?.conversation || '';
      let remoteId = messageObject.data.data.messages?.[0]?.key.remoteJid.split('@')[0];

      if(remoteId.length>13){
        return res.send('invalid number')
      }

      let start = new Date();
      start.setHours(0,0,0,0);

      let end = new Date();
      end.setHours(23,59,59,999);

      const recieverId = await Instance.findOne({instance_id: messageObject.instance_id})
      const senderId = await Contact.findOne({number: remoteId})

      const newMessage = {
        recieverId : recieverId?._id,
        senderNumber: remoteId,
        instanceId: messageObject?.instance_id,
        fromMe: false,
        text: message,
        type: 'text'
      }
      const savedMessage = new Message(newMessage);
      await savedMessage.save();
      const sendMessageObj={
        number: remoteId,
        type: 'text',
        instance_id: messageObject?.instance_id,
      }

      const previousChatLog = await ChatLogs.findOne(
        {
          senderNumber: remoteId,
          instanceId: messageObject?.instance_id,
          updatedAt: { $gte: start, $lt: end }
        },
      ).sort({ updatedAt: -1 });

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

      if(message.toLowerCase()===campaign?.ReportKeyword && senderId?.isAdmin){
        if(!senderId?.isAdmin){
          const response =  await sendMessageFunc({...sendMessageObj, message: 'Invalid Input' });
          return res.send(true);
        }
        const fileName = await getReportdataByTime(start,end, recieverId?._id)
        // const fileName = 'http://5.189.156.200:84/uploads/reports/Report-1716394369435.csv'
        sendMessageObj.filename = fileName.split('/').pop();
        sendMessageObj.media_url= process.env.IMAGE_URL+fileName;
        sendMessageObj.type = 'media';
        const response =  await sendMessageFunc({...sendMessageObj, message:'Download report'});
        return res.send(true);
      }
      
      
      if(message.toLowerCase()===campaign?.StatsKeyword && senderId?.isAdmin){
        if(!senderId?.isAdmin){
          const response =  await sendMessageFunc({...sendMessageObj, message: 'Invalid Input' });
          return res.send(true);
        }

        const replyObj = await getStats1(recieverId,'','');

        let replyMessage = '*Statistics*';
        replyMessage += '\n\n';
        replyMessage += `\n● Total nos of Invitees *${replyObj?.totalContacts}*`;
        replyMessage += `\n● Yes *${replyObj?.yes}*`;
        replyMessage += `\n● No *${replyObj?.no}*`;
        replyMessage += `\n● Balance *${replyObj?.balance}*`;
        
        const response = await sendMessageFunc({...sendMessageObj, message: replyMessage});
        return res.send(true);
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
      if(/yes/i.test(message)){
        if( previousChatLog?.finalResponse){
          const reply =`Your data is already saved . Type *${campaign.RewriteKeyword}* to change`
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
            let reply = campaign?.thankYouText
            if(campaign?.thankYouMedia){              
              sendMessageObj.filename = campaign?.thankYouMedia.split('/').pop();
              sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.thankYouMedia;
              sendMessageObj.type = 'media';
            }
          const response = await sendMessageFunc({...sendMessageObj,message: reply }); 
          return res.send('thank you send')
          }
        }else{
          let reply = campaign?.thankYouText
          if(campaign?.thankYouMedia){              
            sendMessageObj.filename = campaign?.thankYouMedia.split('/').pop();
            sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.thankYouMedia;
            sendMessageObj.type = 'media';
          }
          const response = await sendMessageFunc({...sendMessageObj,message: reply }); 
          return res.send('thank you send')
        }
      }

      if(/no/i.test(message)){
        if( previousChatLog?.finalResponse){
          const reply =`Your data is already saved . Type *${campaign.RewriteKeyword}* to change`
          const response = await sendMessageFunc({...sendMessageObj,message: reply });
          return res.send('Type Change First')
        }

        previousChatLog['messageTrack']=2;
        previousChatLog['finalResponse']=message.toLowerCase();
        await previousChatLog.save()
        let reply = campaign?.messageForRejection
        const response = await sendMessageFunc({...sendMessageObj,message: reply }); 
        return res.send('rejection send')
      }

      if(campaign?.verifyNumberFirst){
        const contact = await Contact.findOne({number: remoteId})
        if(previousChatLog?.messageTrack===2){
          if(message.toLowerCase()===contact.invites.toLowerCase() || (!isNaN(message) && +message < contact.invites || 5)){
            previousChatLog.messageTrack = 3;
            previousChatLog.finalResponse=message;
            // console.log('previousChatLog',previousChatLog);
            await previousChatLog.save(); 
            let reply = campaign?.thankYouText
            if(campaign?.thankYouMedia){              
              sendMessageObj.filename = campaign?.thankYouMedia.split('/').pop();
              sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.thankYouMedia;
              sendMessageObj.type = 'media';
            }
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
    }else{
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
  const newMessage = {
    ...message,
    senderNumber: message?.number,
    instanceId: message?.instance_id,
    fromMe: true,
    text: message?.message,
    media_url: message?.media_url
  }
  if(message?.media_url){
    newMessage['mediaUrl'] = message?.media_url
  }

  // console.log('aaaa',newMessage)
  const savedMessage = new Message(newMessage);
  await savedMessage.save();

  const response = await axios.get(`${url}/send`,{params:{...message,access_token}})
  // console.log(response)
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

function processUserMessage(message, setConfig) {
  // Iterate through setData array to find matching keywords
  // console.log(setConfig.setData)
  if (!message) {
    return null;
  }
  for (const data of setConfig.setData) {
      for (const keyword of data.keywords) {
          if (keyword.toLowerCase().includes(message.toLowerCase())) {
              return data.answer;
          }
      }
  }
  
  return null; // Return default message if no matching keyword is found
}


function getNames(step, number){
  const venueNames = ['Saifee Masjid','Burhani Masjid','MM Warqa']
  const khidmatNames = ['For all Majlis and Miqaat','Only During Ramadan','Only During Ashara','Only During Ramadan and Ashara']
  if(step === 'venue'){
    return venueNames[number-1]
  }else {
    return khidmatNames[number-1]
  }
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
      Status: ele.finalResponse ? ele.finalResponse==='no'?'Rejected':'Accepted':'Pending',
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


async function getStats1(instanceId, startDate, endDate) {
  let dateFilter = {};
  if (startDate && endDate) {
    dateFilter = {
      updatedAt: {
        $gte: new Date(startDate),
        $lt: new Date(endDate)
      }
    };
  }

  
  try {
    const [chatLogsStats, uniqueContacts, totalContacts] = await Promise.all([
      ChatLogs.aggregate([
        {
          $match: {
            instanceId: instanceId.instance_id,
          }
        },
        {
          $facet: {
            totalEntries: [{ $count: "count" }],
            totalYesResponses: [
              { $match: { finalResponse: { $ne: 'no', $nin: [null, ''] } } },
              { $count: "count" }
            ],
            totalNoResponses: [
              { $match: { finalResponse: 'no' } },
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
        { $match: { 'chatlog.0': { $exists: true } } }
      ]),

      Contact.aggregate([
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


module.exports = {
  saveContact,
  getContact,
  updateContacts,
  getMessages,
  sendMessages,
  recieveMessagesV2,
  getReport,
  saveContactsInBulk,
  sendBulkMessage
};
