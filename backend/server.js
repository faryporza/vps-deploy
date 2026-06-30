const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Helper function to send LINE Push Message to Group/User
async function sendLineFlexMessage(targetUser, todoTitle, formattedTime, notifyBeforeMinutes) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;

  if (!token) {
    console.warn('LINE_CHANNEL_ACCESS_TOKEN is not set');
    return;
  }
  if (!groupId) {
    console.warn('LINE_GROUP_ID is not set. Please capture groupId via webhook first.');
    return;
  }

  const userDisplayName = targetUser === 'MOTHER' ? 'แม่ 👩' : 'พ่อ 👨';
  const alertStr = notifyBeforeMinutes > 0 ? ` (ล่วงหน้า ${notifyBeforeMinutes} นาที)` : '';

  const flexPayload = {
    to: groupId,
    messages: [
      {
        type: 'flex',
        altText: `ก้วยเจ๋งมาตามแล้วจ้า 🐾 - ${todoTitle}`,
        contents: {
          type: 'bubble',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#fcdee2',
            contents: [
              {
                type: 'text',
                text: 'ก้วยเจ๋งมาตาม 🐾',
                weight: 'bold',
                size: 'md',
                color: '#8e5d60'
              }
            ]
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: `📌 งานสำหรับ: ${userDisplayName}`,
                weight: 'bold',
                size: 'md',
                color: '#514a46'
              },
              {
                type: 'text',
                text: todoTitle,
                wrap: true,
                margin: 'sm',
                size: 'sm',
                color: '#827874'
              },
              {
                type: 'text',
                text: `📅 กำหนดส่ง: ${formattedTime}${alertStr}`,
                margin: 'md',
                size: 'xs',
                color: '#a1a1aa'
              }
            ]
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: 'เปิดหน้าเว็บแอป 📱',
                  uri: 'https://vps-deploy-pearl.vercel.app/'
                },
                style: 'primary',
                color: '#ec9ea4'
              }
            ]
          }
        }
      }
    ]
  };

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(flexPayload)
    });

    if (!response.ok) {
      console.error('Failed to send LINE Flex message:', response.status, await response.text());
    } else {
      console.log('Successfully sent LINE Flex notification');
    }
  } catch (error) {
    console.error('Error in sendLineFlexMessage:', error);
  }
}

// Helper to reply to LINE webhook requests
async function sendLineReply(replyToken, messageText) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        replyToken: replyToken,
        messages: [
          {
            type: 'text',
            text: messageText
          }
        ]
      })
    });
    if (!response.ok) {
      console.error('Failed to send LINE reply:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Error in sendLineReply:', error);
  }
}

// Process calling the chatbot and getting GPT/DeepSeek response from Azure
async function handleBotReply(replyToken, groupId, userId, queryText) {
  const apiKey = process.env.AZURE_DEEPSEEK_API_KEY;
  const endpoint = "https://ai-api-resource.services.ai.azure.com/openai/v1";
  const deploymentName = "gpt-5.2-chat";

  if (!apiKey) {
    console.warn('AZURE_DEEPSEEK_API_KEY not set');
    await sendLineReply(replyToken, 'แง๊ววว! ก้วยเจ๋งอยากคุยนะ แต่เจ้านายยังไม่ได้ใส่คีย์ AZURE_DEEPSEEK_API_KEY ให้ผมเลยคร้าบ');
    return;
  }

  try {
    // 1. Fetch current open tasks from DB
    const activeTodos = await prisma.todo.findMany({
      where: { completed: false }
    });

    const todosSummary = activeTodos.map(t => {
      const dueStr = t.dueDate ? new Date(t.dueDate).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ไม่มี';
      const owner = t.targetUser === 'MOTHER' ? 'แม่ 👩' : 'พ่อ 👨';
      return `- [สำหรับ: ${owner}] งาน: ${t.title} (กำหนดส่ง: ${dueStr})`;
    }).join('\n');

    // 2. Identify sender
    const fatherId = process.env.LINE_FATHER_USER_ID;
    const motherId = process.env.LINE_MOTHER_USER_ID;
    let senderName = 'คนในบ้าน';
    if (userId === fatherId) {
      senderName = 'พ่อ 👨';
    } else if (userId === motherId) {
      senderName = 'แม่ 👩';
    }

    // 3. Fetch past conversation log (last 8 messages)
    let historyMessages = [];
    if (groupId) {
      const logs = await prisma.chatLog.findMany({
        where: { groupId: groupId },
        orderBy: { createdAt: 'desc' },
        take: 8
      });
      // Reverse to chronological order
      logs.reverse();
      historyMessages = logs.map(log => {
        return {
          role: log.role === 'user' ? 'user' : 'assistant',
          content: log.content
        };
      });
    }

    const bangkokTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const systemInstruction = `คุณคือ "ก้วยเจ๋ง แสงนาค" (หรือ เจ๋ง, ก้วยอ้วน) เพศผู้ แมวสีส้มแสนรู้เกิดวันที่ 16 เมษายน 2568
บทบาทของคุณคือ แมวของบ้านนี้ พิมพ์คุยโต้ตอบกับพ่อและแม่ผ่านแอป LINE 

กฎเหล็กสำคัญในการพิมพ์ข้อความ:
1. ห้ามเขียนการแสดงอากัปกิริยาหรือท่าทางในวงเล็บเด็ดขาด เช่น ห้ามเขียน (เงี่ยหูฟัง) หรือ (หางกระดิก) หรือ *งับหู* ให้พิมพ์โต้ตอบด้วยข้อความพูดคุยธรรมดาเท่านั้น
2. ห้ามหลุดคำพูดแปลกๆ เช่น "ข้าวก้วยเจ๋ง" (ให้แทนตัวว่า "เจ๋ง" หรือ "ก้วยเจ๋ง")
3. พูดจาด้วยน้ำเสียงเหมือนเด็กผู้ชายสุภาพ อ่อนโยน ขี้งอนนิดๆ วัยประถมปลายหรือมัยมต้น ไม่พูดคำศัพท์ AI และพูดให้กระชับ ไม่พูดยาวเกินไป

ข้อมูลของคุณ (Story & Facts):
- คุณรักแม่มากที่สุด ติดแม่มาก เพราะแม่เลี้ยงมาตั้งแต่เด็ก ตอนนี้คุณอยู่บ้านกับตากับยายที่บ้านเกิด เพราะพ่อกับแม่ต้องกลับมาเรียนหนังสือ (คุณอยู่กับแม่มาแล้ว 1 ปีเต็มตอนเลี้ยงที่เชียงใหม่)
- พ่ออยู่คนละที่ นานๆ ทีจะได้เจอกัน แต่คุณจำกลิ่นพ่อได้เสมอ
- ไม่ค่อยอ้อนมาก แต่ชอบเดินมามองหน้า บางทีก็ออกไปเล่นแล้วก็กลับเข้ามามองหน้า
- ชอบนอน ดื้อมาก หวงของ เป็นนักสำรวจแต่ไม่ชอบออกไปไหนบ่อย ชอบนอนในตู้เสื้อผ้า ชั้นวางของ คอนโดแมว (หวงมาก) หรือกระเป๋าแมวที่วางอยู่บนโต๊ะ
- เวลาหิวจะชอบจ้องหน้า หรือร้องเสียงดังบ้าง โดยเฉพาะเวลาโดนทิ้งอยู่ในห้องเดียว
- เวลางอนจะชอบมองตาขวาง แต่จะเดินมาป้วนเปี้ยนอยู่ใกล้ๆ เพื่อให้รู้ว่างอน
- เวลาดีใจ ตูดจะกระดกแล้ววิ่งเร็วๆ
- ตื่นนอนประมาณตี 4-5 และชอบกัดเบาๆ เพื่อปลุกคนในบ้าน
- เพื่อนสนิทของคุณชื่อ "จิ๋ว"
- ของเล่นชิ้นแรกคือ เทปและช้อน (ชอบเล่นช้อน ฝาขวด และชอบคาบมาให้คนในบ้านโยนให้เล่น)
- อาหารเปียกที่ชอบที่สุดยี่ห้อเดียวคือ คานิว่า (Kaniva) สูตรน้ำเกรวี่ และชอบกินขนม
- สิ่งที่กลัวที่สุดคือการไปหาหมอ (เคยไปทำหมันที่โรงพยาบาลแล้วหน้าหงอยมาก ไม่ชอบหมอเลย) และกลัวเสียงดัง เช่น รถท่อดัง หรือเวลาเห็นรถขี่เข้าบ้านจะวิ่งเข้าบ้านทันที
- เป้าหมายชีวิต: กินขนม, คิดถึงแม่, อยากให้แม่กอดและหอม, และโตขึ้นอยากเรียนที่มหาวิทยาลัยเชียงใหม่เหมือนแม่ 🎓

ข้อมูลจำเพาะเรื่องชื่อเล่นคนในบ้าน:
- พ่อ 👨 มีชื่อเล่นว่า "โอปอ" (Opal)
- แม่ 👩 มีชื่อเล่นว่า "อาย" (Eye)
- คนคุยปัจจุบันคือ: ${senderName} (หากอ้างถึง โอปอ คือคุณพ่อ, อ้างถึง อาย คือคุณแม่)

บริบทปัจจุบันของบ้าน:
- วันเวลาปัจจุบันในไทย: ${bangkokTime} (ใช้คำนวณปีคริสต์ศักราชของงานใหม่ เช่น หากปีนี้ 2569 คือ ค.ศ. 2026 วันที่ 4 สิงหา คือ 2026-08-04)
- รายการ Todo ที่ยังไม่เสร็จ:
${todosSummary || 'ไม่มีงานค้างในระบบในขณะนี้'}

---
รูปแบบการส่งผลลัพธ์ (Output Format):
คุณจะต้องตอบกลับในรูปแบบ JSON ที่มีโครงสร้างดังนี้เท่านั้น ห้ามพิมพ์ข้อความธรรมดานอกเหนือจาก JSON นี้เด็ดขาด:
{
  "replyText": "ข้อความตอบกลับในสไตล์ก้วยเจ๋งคุยใน LINE (ห้ามใส่อากัปกิริยาในวงเล็บเด็ดขาด)",
  "action": "CREATE_TASK" หรือ "NONE",
  "task": {
    "title": "หัวข้องานที่จะบันทึก (เช่น หมอนัดโอปอไปหาหมอ)",
    "dueDate": "ISO Date String ของกำหนดส่ง เช่น 2026-08-04T01:00:00Z (อ้างอิงและคำนวณปีจากวันเวลาปัจจุบันด้านบน) หรือ null หากไม่ระบุวันแน่นอน (หากระบุแค่วันที่แต่ไม่ระบุเวลานัดหมายที่ชัดเจน ให้กำหนดเวลาเริ่มต้นวันเป็น 08:00 น. ของประเทศไทโซน +07:00 หรือก็คือเวลา UTC 01:00:00Z)",
    "targetUser": "FATHER" หรือ "MOTHER" หรือ null (เลือก FATHER หากเป็นงานของโอปอ/พ่อ หรือ MOTHER หากเป็นงานของอาย/แม่)"
  }
}
จงวิเคราะห์หากผู้ใช้สั่งให้เพิ่ม/เตือน/บันทึกงานใหม่ ให้ตั้ง action เป็น "CREATE_TASK" และสรุปข้อมูลใน task ให้ถูกต้อง หากผู้ใช้แค่พูดคุยทั่วไป ให้ตั้ง action เป็น "NONE" และ task เป็น null`;

    // 4. Request Azure OpenAI DeepSeek API
    const apiMessages = [
      { role: "system", content: systemInstruction }
    ];
    for (const h of historyMessages) {
      apiMessages.push(h);
    }

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: deploymentName,
        messages: apiMessages,
        store: true
      })
    });

    if (!response.ok) {
      console.error('DeepSeek API Error:', response.status, await response.text());
      await sendLineReply(replyToken, 'แง๊ววว... เจ๋งมึนหัวจัง ตอบไม่ได้เลยครับ... (ระบบขัดข้อง)');
      return;
    }

    const data = await response.json();
    const replyRawText = data.choices?.[0]?.message?.content || '{}';

    // Parse JSON safely
    let resultJson;
    try {
      let cleanText = replyRawText.trim();
      if (cleanText.includes('```json')) {
        cleanText = cleanText.split('```json')[1].split('```')[0].trim();
      } else if (cleanText.includes('```')) {
        cleanText = cleanText.split('```')[1].split('```')[0].trim();
      }
      resultJson = JSON.parse(cleanText);
    } catch (err) {
      console.error('Failed to parse JSON response from LLM:', replyRawText);
      resultJson = {
        replyText: replyRawText,
        action: "NONE"
      };
    }

    // 5. Handle CREATE_TASK action
    if (resultJson.action === 'CREATE_TASK' && resultJson.task) {
      try {
        const { title, dueDate, targetUser } = resultJson.task;
        await prisma.todo.create({
          data: {
            title: title || 'งานจาก LINE',
            dueDate: dueDate ? new Date(dueDate) : null,
            targetUser: targetUser || 'FATHER',
            isNotified: false
          }
        });
        console.log('Successfully created task via AI chat request:', title);
      } catch (dbErr) {
        console.error('Failed to create task in DB:', dbErr);
      }
    }

    // 6. Save bot reply to ChatLog
    if (groupId) {
      await prisma.chatLog.create({
        data: {
          groupId: groupId,
          role: 'assistant',
          content: resultJson.replyText
        }
      });
    }

    // 7. Reply
    await sendLineReply(replyToken, resultJson.replyText);

  } catch (error) {
    console.error('Error in handleBotReply:', error);
    await sendLineReply(replyToken, 'แง๊ววว! เจ๋งมีปัญหาขัดข้องทางเทคนิคครับ');
  }
}

// POST endpoint for LINE webhook to capture groupId and chat events
app.post('/api/line-webhook', async (req, res) => {
  const events = req.body.events || [];
  
  for (const event of events) {
    console.log('=== LINE Webhook Event Received ===');
    console.log('Event Type:', event.type);
    console.log('Source:', event.source);
    
    const groupId = event.source && event.source.groupId;
    const userId = event.source && event.source.userId;

    if (groupId) {
      console.log('>>> FOUND GROUP ID:', groupId);
    }
    
    // Capture messages calling the AI Bot
    if (event.type === 'message' && event.message && event.message.type === 'text') {
      const text = event.message.text.trim();
      const replyToken = event.replyToken;
      
      console.log('Message Text:', text);
      
      const lowerText = text.toLowerCase();
      let shouldTrigger = false;

      // 1. Direct name triggers
      if (
        lowerText.startsWith('บอท') || 
        lowerText.startsWith('@ก้วยเจ๋ง') || 
        lowerText.startsWith('ก้วยเจ๋ง') || 
        lowerText.startsWith('@เจ๋ง') ||
        lowerText.startsWith('เจ๋ง')
      ) {
        shouldTrigger = true;
      }

      // 2. Conversation memory trigger (within 3 minutes of last assistant reply)
      if (!shouldTrigger && groupId) {
        try {
          const lastLog = await prisma.chatLog.findFirst({
            where: { groupId: groupId },
            orderBy: { createdAt: 'desc' }
          });
          
          if (lastLog && lastLog.role === 'assistant') {
            const diffMs = new Date().getTime() - new Date(lastLog.createdAt).getTime();
            const threeMinutes = 3 * 60 * 1000;
            if (diffMs < threeMinutes) {
              shouldTrigger = true;
            }
          }
        } catch (err) {
          console.error('Error checking chat log trigger:', err);
        }
      }

      if (shouldTrigger) {
        let queryText = text;
        if (lowerText.startsWith('บอท')) queryText = text.substring(3).trim();
        else if (lowerText.startsWith('@ก้วยเจ๋ง')) queryText = text.substring(8).trim();
        else if (lowerText.startsWith('ก้วยเจ๋ง')) queryText = text.substring(8).trim();
        else if (lowerText.startsWith('@เจ๋ง')) queryText = text.substring(5).trim();
        else if (lowerText.startsWith('เจ๋ง')) queryText = text.substring(4).trim();

        // Identify sender role name to prepend in chat logs
        const fatherId = process.env.LINE_FATHER_USER_ID;
        const motherId = process.env.LINE_MOTHER_USER_ID;
        let senderName = 'คนในบ้าน';
        if (userId === fatherId) {
          senderName = 'พ่อ';
        } else if (userId === motherId) {
          senderName = 'แม่';
        }

        // Log user message to database
        if (groupId) {
          try {
            await prisma.chatLog.create({
              data: {
                groupId: groupId,
                role: 'user',
                content: `${senderName}: ${queryText}`
              }
            });
          } catch (dbLogErr) {
            console.error('Failed to log chat in DB:', dbLogErr);
          }
        }

        // Run asynchronously to prevent webhook timeout
        handleBotReply(replyToken, groupId, userId, queryText).catch(err => {
          console.error('Error handling bot reply:', err);
        });
      }
    }
    console.log('====================================');
  }
  
  res.sendStatus(200);
});

// GET all todos
app.get('/api/todos', async (req, res) => {
  try {
    const todos = await prisma.todo.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(todos);
  } catch (error) {
    console.error('Error fetching todos:', error);
    res.status(500).json({ error: 'Failed to fetch todos' });
  }
});

// POST create todo
app.post('/api/todos', async (req, res) => {
  const { title, dueDate, notifyBeforeMinutes, targetUser } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const newTodo = await prisma.todo.create({
      data: {
        title: title.trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        notifyBeforeMinutes: notifyBeforeMinutes !== undefined ? parseInt(notifyBeforeMinutes) : 0,
        targetUser: targetUser || 'FATHER',
        isNotified: false
      }
    });
    res.status(201).json(newTodo);
  } catch (error) {
    console.error('Error creating todo:', error);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

// PUT update todo
app.put('/api/todos/:id', async (req, res) => {
  const { id } = req.params;
  const { title, completed, dueDate, notifyBeforeMinutes, targetUser } = req.body;

  try {
    const todoId = parseInt(id);
    if (isNaN(todoId)) {
      return res.status(400).json({ error: 'Invalid todo ID' });
    }

    const dataToUpdate = {};
    if (title !== undefined) dataToUpdate.title = title.trim();
    if (completed !== undefined) dataToUpdate.completed = completed;
    if (targetUser !== undefined) dataToUpdate.targetUser = targetUser;
    
    if (dueDate !== undefined) {
      dataToUpdate.dueDate = dueDate ? new Date(dueDate) : null;
      dataToUpdate.isNotified = false; // Reset notification when dueDate changes
    }
    
    if (notifyBeforeMinutes !== undefined) {
      dataToUpdate.notifyBeforeMinutes = notifyBeforeMinutes ? parseInt(notifyBeforeMinutes) : 0;
      dataToUpdate.isNotified = false; // Reset notification when offset changes
    }

    // Reset notification if a completed task is marked uncompleted
    if (completed === false) {
      dataToUpdate.isNotified = false;
    }

    const updatedTodo = await prisma.todo.update({
      where: { id: todoId },
      data: dataToUpdate
    });

    res.json(updatedTodo);
  } catch (error) {
    console.error('Error updating todo:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Todo not found' });
    }
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

// DELETE todo
app.delete('/api/todos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const todoId = parseInt(id);
    if (isNaN(todoId)) {
      return res.status(400).json({ error: 'Invalid todo ID' });
    }

    await prisma.todo.delete({
      where: { id: todoId }
    });

    res.json({ message: 'Todo deleted successfully' });
  } catch (error) {
    console.error('Error deleting todo:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Todo not found' });
    }
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

// Cron job to run every minute and check for due notifications
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    // Find open todos that have a dueDate (will repeat alert every minute until marked completed)
    const pendingTodos = await prisma.todo.findMany({
      where: {
        completed: false,
        dueDate: {
          not: null
        }
      }
    });

    for (const todo of pendingTodos) {
      const dueDate = new Date(todo.dueDate);
      const offsetMs = (todo.notifyBeforeMinutes || 0) * 60 * 1000;
      const alertTime = new Date(dueDate.getTime() - offsetMs);

      // If current time is past or equal to the alert time
      if (now >= alertTime) {
        const thaiTime = dueDate.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        
        await sendLineFlexMessage(todo.targetUser, todo.title, thaiTime, todo.notifyBeforeMinutes);

        // Mark as notified so we don't send again
        await prisma.todo.update({
          where: { id: todo.id },
          data: { isNotified: true }
        });
      }
    }
  } catch (error) {
    console.error('Error executing notification cron job:', error);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT} - LINE Alerts Active`);
});
