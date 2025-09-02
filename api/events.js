// api/events.js - Události pro období
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

// Pomocná funkce pro parsování událostí
function parseEvent(event) {
  const title = event.summary || '';
  const description = event.description || '';
  
  let type = 'unknown';
  let contact = '';
  let phone = '';
  let duration = '';
  let content = '';
  
  if (title.includes('Hovor') || title.includes('Call') || title.includes('Volání')) {
    type = 'call';
    const contactMatch = title.match(/(?:Hovor|Call|Volání)[\s\-:]*(.+?)(?:\s*\(|\s*$)/);
    if (contactMatch) {
      contact = contactMatch[1].trim();
    }
    const durationMatch = description.match(/(?:délka|duration|trvání)[\s:]*(\d+\s*(?:min|minut|s|sekund))/i);
    if (durationMatch) {
      duration = durationMatch[1];
    }
  } else if (title.includes('SMS') || title.includes('Zpráva') || title.includes('Message')) {
    type = 'sms';
    const contactMatch = title.match(/(?:SMS|Zpráva|Message)[\s\-:]*(.+?)(?:\s*\(|\s*$)/);
    if (contactMatch) {
      contact = contactMatch[1].trim();
    }
    content = description.replace(/telefon[\s:]*\+?\d+[\s\d\-\(\)]*\n?/gi, '').trim();
  }
  
  const phoneMatch = description.match(/(?:telefon|phone|číslo)[\s:]*(\+?\d+[\s\d\-\(\)]+)/i);
  if (phoneMatch) {
    phone = phoneMatch[1].replace(/[\s\-\(\)]/g, '');
  } else {
    const phonePattern = /(\+?\d{3,4}[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{3})/;
    const phoneInText = (title + ' ' + description).match(phonePattern);
    if (phoneInText) {
      phone = phoneInText[1];
    }
  }
  
  return {
    id: event.id,
    date: event.start.dateTime ? event.start.dateTime.split('T')[0] : event.start.date,
    time: event.start.dateTime ? 
      new Date(event.start.dateTime).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) :
      '00:00',
    type,
    contact: contact || 'Neznámý kontakt',
    phone,
    duration,
    content: content || description,
    originalTitle: title,
    originalDescription: description
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { startDate, endDate, calendarId = 'primary', date } = req.query;
    
    // Pokud je zadán parametr 'date', použij ho pro startDate i endDate
    let actualStartDate = startDate;
    let actualEndDate = endDate;
    
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Neplatný formát datumu. Použijte YYYY-MM-DD' });
      }
      actualStartDate = date;
      actualEndDate = date;
    }
    
    if (!actualStartDate || !actualEndDate) {
      return res.status(400).json({ error: 'startDate a endDate (nebo date) jsou povinné parametry' });
    }
    
    const response = await calendar.events.list({
      calendarId,
      timeMin: new Date(actualStartDate).toISOString(),
      timeMax: new Date(actualEndDate + 'T23:59:59').toISOString(),
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
    
    res.status(200).json({
      events: communicationEvents,
      total: communicationEvents.length,
      date: date || `${actualStartDate} to ${actualEndDate}`
    });
    
  } catch (error) {
    console.error('Chyba při získávání událostí:', error);
    res.status(500).json({ 
      error: 'Chyba při získávání událostí z kalendáře',
      details: error.message 
    });
  }
}
