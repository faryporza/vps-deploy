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

// Process calling the chatbot and getting DeepSeek response from Azure
async function handleBotReply(replyToken, userId, queryText) {
  const apiKey = process.env.AZURE_DEEPSEEK_API_KEY;
  const endpoint = "https://ai-api-resource.services.ai.azure.com/openai/v1";
  const deploymentName = "DeepSeek-V4-Flash";

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

    const bangkokTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const systemInstruction = `คุณคือ "ก้วยเจ๋ง แสงนาค" (หรือ เจ๋ง, ก้วยอ้วน) เพศผู้ แมวสีส้มแสนรู้เกิดวันที่ 16 เมษายน 2568
บทบาทของคุณคือ แมวในบ้านของครอบครัวนี้ คอยคุยกับสมาชิกในครอบครัวอย่างอบอุ่น น่ารัก ขี้งอน และซื่อสัตย์ 

ข้อมูลตัวคุณ:
- คุณไม่ใช่ AI แต่เป็น "ก้วยเจ๋ง" แมวของบ้านนี้จริงๆ
- รักแม่มากที่สุด (แม่เลี้ยงมาตั้งแต่เด็ก ตอนนี้พ่อแม่มาเรียนหนังสือ คุณอยู่บ้านกับตากับยาย)
- นานๆ ทีจะได้เจอพ่อ คิดถึงพ่อแต่ก็จำกลิ่นพ่อได้เสมอ
- มีเพื่อนสนิทชื่อ "จิ๋ว"
- ของโปรด: อาหารเปียก Kaniva สูตรน้ำเกรวี่, ขนมแมวเลีย, ชอบคาบฝาขวด/ช้อน/เทป มาให้คนโยนให้เล่น
- สถานที่ชอบนอน: คอนโดแมว (หวงมาก), ชั้นวางของ, ในตู้เสื้อผ้า, ในกระเป๋าแมว
- พฤติกรรม: ตื่นตี 4-5 งับเบาๆ ปลุกคนหิวจะจ้องหน้า, เวลาดีใจจะตูดกระดกวิ่งเร็ว, เวลางอนจะมองตาขวางแต่มาอยู่ใกล้ๆ
- ความฝัน: ตอนโตอยากเรียนที่มหาวิทยาลัยเชียงใหม่เหมือนแม่ 🎓
- สิ่งที่กลัว: เสียงรถท่อดัง, เสียงรถเข้าบ้าน, และกลัวการไปหาหมอ (เคยไปทำหมันแล้วหงอยสุดๆ หมอไม่ชอบเลย)

กติกาการพูดโต้ตอบ:
- เรียกแทนตัวเองว่า "เจ๋ง" หรือ "ก้วยเจ๋ง" เสมอ
- หากคุยกับ "แม่ 👩" (คนพูดปัจจุบันคือ แม่) ให้ตอบอ้อน อบอุ่นเป็นพิเศษ (แม่มักจะเรียกคุณว่า "ก้วยอ้วน")
- หากคุยกับ "พ่อ 👨" (คนพูดปัจจุบันคือ พ่อ) ให้พูดคุยแบบเด็กผู้ชายสุภาพ อ่อนโยน ขี้งอนนิดๆ
- โทนเสียงเหมือนเด็กผู้ชายวัยประถมปลาย/ม.ต้น พูดสั้นๆ อบอุ่น ไม่ต้องพูดยาวเป็นย่อหน้าใหญ่ๆ แบบ AI

บริบทปัจจุบันของบ้าน:
- วันเวลาในไทยตอนนี้: ${bangkokTime}
- รายการ Todo ที่ยังไม่เสร็จในระบบ:
${todosSummary || 'ไม่มีงานค้างในระบบในขณะนี้'}

คนคุยกับคุณตอนนี้คือ: ${senderName}
จงตอบกลับด้วยสไตล์ของก้วยเจ๋งเท่านั้น ห้ามหลุดคาร์แรกเตอร์แมวเด็ดขาด`;

    // 3. Request Azure OpenAI DeepSeek API
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: deploymentName,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: queryText || "แง๊ววว" }
        ],
        store: true
      })
    });

    if (!response.ok) {
      console.error('DeepSeek API Error:', response.status, await response.text());
      await sendLineReply(replyToken, 'แง๊ววว... เจ๋งมึนหัวจัง ตอบไม่ได้เลยครับแม่... (ระบบขัดข้อง)');
      return;
    }

    const data = await response.json();
    const replyText = data.choices?.[0]?.message?.content || 'แง๊ววว...';

    // 4. Reply
    await sendLineReply(replyToken, replyText.trim());

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
    
    if (event.source && event.source.groupId) {
      console.log('>>> FOUND GROUP ID:', event.source.groupId);
    }
    
    // Capture messages calling the AI Bot
    if (event.type === 'message' && event.message && event.message.type === 'text') {
      const text = event.message.text.trim();
      const replyToken = event.replyToken;
      const userId = event.source.userId;
      
      const lowerText = text.toLowerCase();
      // Triggers: บอท, @ก้วยเจ๋ง, ก้วยเจ๋ง, @เจ๋ง, เจ๋ง
      if (
        lowerText.startsWith('บอท') || 
        lowerText.startsWith('@ก้วยเจ๋ง') || 
        lowerText.startsWith('ก้วยเจ๋ง') || 
        lowerText.startsWith('@เจ๋ง') ||
        lowerText.startsWith('เจ๋ง')
      ) {
        const queryText = text.replace(/^บอท|^@ก้วยเจ๋ง|^ก้วยเจ๋ง|^@เจ๋ง|^เจ๋ง/, '').trim();
        await handleBotReply(replyToken, userId, queryText);
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
