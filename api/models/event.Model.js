const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
  eventName: { type: String, required: true },
  startDate: { type: Date, required: true },
  startHour: { type: Number, required: true },
  startMinute: { type: Number, required: true },
  endDate: { type: Date, required: true },
  endHour: { type: Number, required: true },
  endMinute: { type: Number, required: true },
  startingKeyword: { type: String, required: true },
  verifyNumberFirst: { type: Boolean, default: false },
  numberVerificationFails: { type: String },
  
  invitationText: { type: String, required: true },
  invitationMedia: { type: String },
  invitationMediaMime: { type: String },

  acceptanceKeyword: { type: String},
  thankYouText: { type: String },
  thankYouMedia: { type: String },
  thankYouMediaMime: { type: String },

  RejectionKeyword: { type: String},
  messageForRejection: { type: String },

  messageForMoreThanOneInvites: { type: String, required: true },
  messageForClosedInvitations: { type: String, required: true},

  RewriteKeyword: { type: String, required: true },
  ReportKeyword: { type: String, required: true },
  StatsKeyword: { type: String, required: true },

  eventUID : { type: String},

  createdBy: { type: mongoose.Types.ObjectId },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  initialCode: { type: String},
  inviteCode: { type: String},
  acceptCode: { type: String},
  rejectCode: { type: String},
  newContactCode: {type: String},
});
const Event = mongoose.model('event', EventSchema);

module.exports = Event;
