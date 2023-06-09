const dotenv = require('dotenv');
const express = require('express')
const path = require('path');
const cors = require('cors')
const bodyParser = require('body-parser')
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');


dotenv.config();

const app = express()
app.use(cors())
app.use(bodyParser.json())

const API_URL = 'https://api.openai.com/v1/chat/completions';
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const extractContent = async (url) => {
  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_IO_KEY}`,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });

    const bodyHandle = await page.$('body');
    const html = await page.evaluate(body => body.innerHTML, bodyHandle);
    await bodyHandle.dispose();
    await browser.close();

    const $ = cheerio.load(html);

    // Try multiple selectors
    const selectors = ['article', 'main', '.post', '.entry-content', '#content', '.article-body'];
    let mainContent = '';

    for (let selector of selectors) {
      const content = $(selector).text();
      if (content.length > mainContent.length) {
        mainContent = content;
      }
    }

    return mainContent;
  } catch (error) {
    console.error(error);
    throw new Error("Content extraction failed");
  }
};


const CHUNK_SIZE = 4096; // adjust this value based on the API's token limit

const getUrlSummary = async (text, summarizationType) => {
  let instruction;
  if (summarizationType === 'Default') {
    instruction = 'Summarize the following text:';
  } else {
    instruction = `Summarize the following text in a ${summarizationType} style:`;
  }
  
  const chunks = chunkText(text, CHUNK_SIZE);

  // Prepare all the requests but don't send them yet
  const requests = chunks.map(chunk => 
    axios.post(API_URL, {
      model: 'gpt-3.5-turbo',
      messages: [
        {role: 'system', content: 'You are a helpful assistant.'},
        {role: 'user', content: instruction},
        {role: 'user', content: chunk},
      ],
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_KEY}`
      }
    })
    .then(response => response.data.choices[0].message.content.trim())
    .catch(error => {
      console.error("Error in getUrlSummary:", error);
      console.error(error);
      if (error.response && error.response.status === 429) {
        return 'Error: Rate limit exceeded, try again later.';
      } else {
        return 'Error: An unknown error occurred.';
      }
    })
  );

  // Now send all the requests in parallel and wait for all of them to complete
  const summaries = await Promise.all(requests);

  return summaries.join('\n'); // Join the summaries together
}


const chunkText = (text, size) => {
  var chunks = [];
  while (text) {
    if (text.length < size) {
      chunks.push(text);
      break;
    } else {
      let pos = text.lastIndexOf(' ', size); // don't cut off mid-word
      let chunk = text.slice(0, pos);
      chunks.push(chunk);
      text = text.slice(pos);
    }
  }
  return chunks;
}

app.post('/api/summarize', async (req, res) => {
  console.log("Received request", req.body);
  const { url, summarizationType } = req.body;
  console.log(url, summarizationType)
  const content = await extractContent(url);
  console.log("Extracted content", content);
  console.log(content);
  let summary = await getUrlSummary(content, summarizationType);
  console.log("Generated summary", summary);
  if (summarizationType === 'Bullet Point') {
    let isFirstMatch = true;
    summary = summary.replace(/- /g, (match) => {
      if (isFirstMatch) {
        isFirstMatch = false;
        return match;
      } else {
        return "<br/><br/>- ";
      }
    });
  }
  res.json({ summary });
  console.log("Sent response", { summary })
});

  

app.use(express.static(path.join(__dirname, '../../build')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../build', 'index.html'));
});
