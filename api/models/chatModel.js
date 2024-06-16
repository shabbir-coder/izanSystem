const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  invites: { type: String, required: true },
  number: { type: String, required: true },
  isVerified : {type: Boolean, default: false},
  lastResponse: {type: String, default:''},
  lastResponseUpdatedAt: {type: Date},
  isAdmin: {type: Boolean, default: false},
  createdBy: {type: mongoose.Types.ObjectId},
  instanceId: {type: String},
  eventId: {type: String},
},{timestamps: true});

const chatLogs = new mongoose.Schema({
  senderNumber: { type: String },
  isValid: {type: Boolean, default: false},
  finalResponse: {type: String},
  otherMessages : {type: {}},
  instanceId: {type: String},
  eventId: {type: String},
  messageTrack: {type: Number , default: null},
}, { timestamps: true }
);


const chatSchema = new mongoose.Schema({
  eventId: {type: mongoose.Schema.Types.ObjectId},
  senderNumber: { type: String },
  fromMe: {type: Boolean},
  recieverId: { type: mongoose.Schema.Types.ObjectId},
  instanceId: {type: String},
  text: { type: String},
  type: {type: String},
  mediaUrl: {type: String},
  // Add other message-related fields as needed
}, { timestamps: true }
);

const ChatLogs = mongoose.model('chatLogs', chatLogs);
const Contact = mongoose.model('contact', contactSchema);
const Message = mongoose.model('message', chatSchema);

module.exports = { Contact, Message, ChatLogs };
