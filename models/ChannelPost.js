const mongoose = require('mongoose');

const buttonSchema = new mongoose.Schema({
    type: { 
        type: String, 
        enum: ['url', 'bot', 'support', 'webapp'], 
        required: true 
    },
    text: { type: String, required: true },
    value: { type: String, required: true }
});

const channelPostSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    image_url: String,
    buttons: [buttonSchema],
    status: { 
        type: String, 
        enum: ['draft', 'published', 'archived'], 
        default: 'draft' 
    },
    sent_to: [String],
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    published_at: Date
});

const ChannelPost = mongoose.model('ChannelPost', channelPostSchema);

module.exports = ChannelPost; 