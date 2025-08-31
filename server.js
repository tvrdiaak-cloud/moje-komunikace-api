// server.js
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Google Calendar konfigurace
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Nastavení přístupových tokenů (po autorizaci)
oauth2Client.setCredentials({
  access_token: process.env.GOOGLE_ACCESS_TOKEN,
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Pomocná funkce pro parsování událostí
function parseEvent(event) {
  const title = event.summary || '';
  const description = event.description || '';
  
  // Rozpoznání typu komunikace z názvu/popisu
  let type = 'unknown';
  let contact = '';
  let phone = '';
  let duration = '';
  let content = '';
  
  if (title.includes('Hovor') || title.includes('Call') || title.includes('Volání')) {
    type = 'call';
    
    // Extrakce kontaktu z názvu (např. "Hovor - Jan Novák")
    const contactMatch = title.match(/(?:Hovor|Call|Volání)[\s\-:]*(.+?)(?:\s*\(|\s*$)/);
    if (contactMatch) {
      contact = contactMatch[1].trim();
    }
    
    // Extrakce délky hovoru z popisu
    const durationMatch = description.match(/(?:délka|duration|trvání)[\s:]*(\d+\s*(?:min|minut|s|sekund))/i);
    if (durationMatch) {
      duration = durationMatch[1];
    }
    
  } else if (title.includes('SMS') || title.includes('Zpráva') || title.includes('Message')) {
    type = 'sms';
    
    // Extrakce kontaktu z názvu
    const contactMatch = title.match(/(?:SMS|Zpráva|Message)[\s\-:]*(.+?)(?:\s*\(|\s*$)/);
    if (contactMatch) {
      contact = contactMatch[1].trim();
    }
    
    // Obsah zprávy je obvykle v popisu
    content = description.replace(/telefon[\s:]*\+?\d+[\s\d\-\(\)]*\n?/gi, '').trim();
  }
  
  // Extrakce telefonního čísla z popisu
  const phoneMatch = description.match(/(?:telefon|phone|číslo)[\s:]*(\+?\d+[\s\d\-\(\)]+)/i);
  if (phoneMatch) {
    phone = phoneMatch[1].replace(/[\s\-\(\)]/g, '');
  } else {
    // Hledání telefonního čísla v celém textu
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

// API Endpoints

// Získání událostí pro konkrétní období
app.get('/api/events', async (req, res) => {
  try {
    const { startDate, endDate, calendarId = 'primary' } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate a endDate jsou povinné parametry' });
    }
    
    const response = await calendar.events.list({
      calendarId,
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate + 'T23:59:59').toISOString(),
      maxResults: 1000,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    const events = response.data.items || [];
    
    // Filtrace a parsování událostí souvisejících s komunikací
    const communicationEvents = events
      .filter(event => {
        const title = (event.summary || '').toLowerCase();
        const description = (event.description || '').toLowerCase();
        
        // Hledání klíčových slov pro komunikaci
        const keywords = ['hovor', 'call', 'volání', 'sms', 'zpráva', 'message', 'telefon'];
        return keywords.some(keyword => title.includes(keyword) || description.includes(keyword));
      })
      .map(parseEvent)
      .filter(event => event.type !== 'unknown'); // Odfiltrování nerozpoznaných událostí
    
    res.json({
      events: communicationEvents,
      total: communicationEvents.length
    });
    
  } catch (error) {
    console.error('Chyba při získávání událostí:', error);
    res.status(500).json({ 
      error: 'Chyba při získávání událostí z kalendáře',
      details: error.message 
    });
  }
});

// Získání událostí pro konkrétní den
app.get('/api/events/day/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { calendarId = 'primary' } = req.query;
    
    // Validace datumu
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Neplatný formát datumu. Použijte YYYY-MM-DD' });
    }
    
    const startDate = date;
    const endDate = date;
    
    // Přesměrování na obecný endpoint
    req.query = { startDate, endDate, calendarId };
    return app._router.handle({ ...req, url: '/api/events', query: req.query }, res);
    
  } catch (error) {
    console.error('Chyba při získávání událostí pro den:', error);
    res.status(500).json({ 
      error: 'Chyba při získávání událostí pro konkrétní den',
      details: error.message 
    });
  }
});

// Vyhledávání v událostech
app.get('/api/events/search', async (req, res) => {
  try {
    const { q, startDate, endDate, type } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Parametr q (vyhledávací dotaz) je povinný' });
    }
    
    // Nejprve získáme všechny události
    const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const defaultEndDate = endDate || new Date().toISOString().split('T')[0];
    
    req.query = { startDate: defaultStartDate, endDate: defaultEndDate };
    
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
    
    // Filtrace podle vyhledávacího dotazu
    const searchWords = q.toLowerCase().split(' ').filter(word => word.length > 0);
    const filteredEvents = communicationEvents.filter(event => {
      const searchableText = `${event.contact} ${event.content} ${event.phone} ${event.originalTitle} ${event.originalDescription}`.toLowerCase();
      return searchWords.every(word => searchableText.includes(word));
    });
    
    // Filtrace podle typu
    const finalEvents = type && type !== 'all' ? 
      filteredEvents.filter(event => event.type === type) : 
      filteredEvents;
    
    res.json({
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
});

// Získání informací o kalendářích
app.get('/api/calendars', async (req, res) => {
  try {
    const response = await calendar.calendarList.list();
    const calendars = response.data.items.map(cal => ({
      id: cal.id,
      name: cal.summary,
      description: cal.description,
      primary: cal.primary || false
    }));
    
    res.json({ calendars });
    
  } catch (error) {
    console.error('Chyba při získávání kalendářů:', error);
    res.status(500).json({ 
      error: 'Chyba při získávání seznamu kalendářů',
      details: error.message 
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Neočekávaná chyba:', error);
  res.status(500).json({ 
    error: 'Vnitřní chyba serveru',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}`);
  console.log(`API dostupné na: http://localhost:${PORT}/api/`);
});

module.exports = app;
