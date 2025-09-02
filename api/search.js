// api/search.js - Vyhledávání v událostech
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  access_token: process.env.GOOGLE_ACCESS_TOKEN,
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Stejná parseEvent funkce jako výše
function parseEvent(event) {
  // ... zkopírujte parseEvent funkci z api/events.js
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { q, startDate, endDate, type } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Parametr q (vyhledávací dotaz) je povinný' });
    }
    
    const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const defaultEndDate = endDate || new Date().toISOString().split('T')[0];
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(defaultStartDate).toISOString(),
      timeMax: new Date(defaultEndDate + 'T23:59:59').toISOString(),
      maxResults: 1000,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    const events = response.data.items || [];
    const communicationEvents = events
      .filter(event => {
        const title = (event.summary || '').toLowerCase();
        const description = (event.description || '').toLowerCase();
        const keywords = ['hovor', 'call', 'volání', 'sms', 'zpráva', 'message', 'telefon'];
        return keywords.some(keyword => title.includes(keyword) || description.includes(keyword));
      })
      .map(parseEvent)
      .filter(event => event.type !== 'unknown');
    
    const searchWords = q.toLowerCase().split(' ').filter(word => word.length > 0);
    const filteredEvents = communicationEvents.filter(event => {
      const searchableText = `${event.contact} ${event.content} ${event.phone} ${event.originalTitle} ${event.originalDescription}`.toLowerCase();
      return searchWords.every(word => searchableText.includes(word));
    });
    
    const finalEvents = type && type !== 'all' ? 
      filteredEvents.filter(event => event.type === type) : 
      filteredEvents;
    
    res.status(200).json({
      events: finalEvents,
      total: finalEvents.length,
      query: q
    });
    
  } catch (error) {
    console.error('Chyba při vyhledávání:', error);
    res.status(500).json({ 
      error: 'Chyba při vyhledávání událostí',
      details: error.message 
    });
  }
}
