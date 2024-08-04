const Event = require('../models/event.Model');
const Instance = require('../models/instanceModel')
const {Message, Contact, ChatLogs} = require('../models/chatModel');
const fs = require('fs')


function generateUniqueCode(length = 5) {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      code += characters[randomIndex];
    }
    return code;
  }

exports.saveOrUpdateCampaign = async (req, res) => {
    try {
      const { _id, ...data } = req.body;
  
      let campaign;
  
      if (_id) {
        data.updatedAt = new Date();  // Update updatedAt field
        campaign = await Event.findByIdAndUpdate(_id, data, { new: true });
      } else {
        data.campaignUID = generateUniqueCode();
        data.createdBy = req.user.userId;  // Add createdBy field

        campaign = new Event(data);
        await campaign.save();
      }
  
      res.status(200).json(campaign);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  exports.saveOrUpdateEvent = async (req, res) => {
    try {
      const { _id, ...data } = req.body;
      let event;
  
      if (_id) {
        data.updatedAt = new Date();  // Update updatedAt field
        event = await Event.findByIdAndUpdate(_id, data, { new: true });
      } else {
        data.eventUID = generateUniqueCode();
        data.createdBy = req.user.userId;  // Add createdBy field
  
        event = new Event(data);
        await event.save();
      }
  
      res.status(200).json(event);
    } catch (error) {
      console.log(error)
      res.status(500).json({ error: error.message });
    }
  };
  
  // View Campaign by ID
  exports.getEventById = async (req, res) => {
    try {
      const { id } = req.params;
      console.log(id, 'here')
      const campaign = await Event.findById(id);
      
      if (!campaign) {
        return res.status(404).json({ message: 'Campaign not found' });
      }
  
      return res.status(200).json(campaign);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  };
  
  // List All Campaigns
  exports.listAllEvents = async (req, res) => {
    try {
      const userId = req.user.userId;  // Get userId from request
      const campaigns = await Event.find({ createdBy: userId })
      .select('eventName eventUID _id updatedAt startDate endDate ');;  // Fetch campaigns by createdBy field
    
      res.status(200).json({data: campaigns});
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };


  // Delete Campaign
  exports.deleteEventData = async (req, res) => {
    try {
      const { eventId } = req.params;
       // Delete instances related to the campaign
    await Instance.deleteMany({ eventId });

    // Delete contacts related to the campaign
    await Contact.deleteMany({ eventId });

    // Delete chatsLogs related to the campaign
    await ChatLogs.deleteMany({ eventId });

    // Delete messages related to the campaign
    await Message.deleteMany({ eventId });

    const result = await Event.findByIdAndDelete(eventId);
  
      if (!result) {
        return res.status(404).json({ message: 'Campaign not found' });
      }
  
      res.status(200).json({ message: 'Campaign deleted successfully' });
    } catch (error) {
      console.log(error)
      res.status(500).json({ error: error.message });
    }
  };

  exports.deleteChatsData = async (req, res) => {
    try {
      const eventId = req.params.eventId;
  
      // Delete chats related to the campaign
      await ChatLogs.deleteMany({ eventId });

      // Delete messages related to the campaign
      await Message.deleteMany({ eventId });
  
      await Contact.updateMany(
        { eventId: eventId },
        {
          $set: { lastResponse: "", inviteStatus: "Pending" }
        }
      );
  
      res.status(200).json({ message: 'Chats for the campaign deleted successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Error deleting chats', error });
    }
  }

  exports.deleteContactsData = async (req, res) => {
    try {
      const eventId = req.params.eventId;
  
      // Find the contact to get the campaignId
      const result = await Contact.deleteMany({ eventId });
      
      if (!result) {
        return res.status(404).json({ message: 'Contacts not found' });
      }

      // Delete chatsLogs related to the campaign
      await ChatLogs.deleteMany({ eventId });
  
      // Delete messages related to the campaign
      await Message.deleteMany({ eventId });
  
  
      res.status(200).json({ message: 'Contact and related chats deleted successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Error deleting contact', error });
    }
  }

  exports.deleteContactByNumber = async (req, res) => {
    try {
      const number = req.params.id;
  
      // Find the contact to get the campaignId
      const result = await Contact.deleteOne({ number });
      
      if (!result) {
        return res.status(404).json({ message: 'Contacts not found' });
      }

      // Delete chatsLogs related to the campaign
      await ChatLogs.deleteMany({ senderNumber: number });
  
      // Delete messages related to the campaign
      await Message.deleteMany({ senderNumber: number });
  
  
      res.status(200).json({ message: 'Contact and related chats deleted successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Error deleting contact', error });
    }
  }
  

  exports.uploadFiles = async (req, res)=>{
    const files = {};
    if (req.files['invitationMedia']) {
      files.invitationMedia = {
        url: `/uploads/${req.files['invitationMedia'][0].filename}`,
        mimeType: req.files['invitationMedia'][0].mimetype
      };
    }
    if (req.files['thankYouMedia']) {
      files.thankYouMedia = {
        url: `/uploads/${req.files['thankYouMedia'][0].filename}`,
        mimeType: req.files['thankYouMedia'][0].mimetype
      };
    }
    return res.status(200).json(files);
  }

  