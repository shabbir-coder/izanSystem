const express = require('express');
const eventController = require('../controllers/event.controller');
const { authenticateToken } = require('../middlewares/auth');
const upload = require('../middlewares/multer');


const router = express.Router();

router.post('',
    authenticateToken,
    eventController.saveOrUpdateEvent);
router.get('', authenticateToken, eventController.listAllEvents);
router.get('/:id', authenticateToken, eventController.getEventById);

router.post('/upload', authenticateToken,
upload.fields([
    { name: 'invitationMedia', maxCount: 1 },
    { name: 'thankYouMedia', maxCount: 1 }]), eventController.uploadFiles);


router.delete('/:eventId', authenticateToken, eventController.deleteEventData); // delete Event

router.delete('/chats/:eventId', authenticateToken, eventController.deleteChatsData); // delete Event

router.delete('/contacts/:eventId', authenticateToken, eventController.deleteContactsData); // delete Event

router.delete('/contact/:id', authenticateToken, eventController.deleteContactByNumber);


module.exports = router;
