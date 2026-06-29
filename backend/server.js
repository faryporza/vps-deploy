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

// Helper function to send LINE Flex Message to Group/User
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

// POST endpoint for LINE webhook to capture groupId
app.post('/api/line-webhook', (req, res) => {
  const events = req.body.events || [];
  
  for (const event of events) {
    console.log('=== LINE Webhook Event Received ===');
    console.log('Event Type:', event.type);
    console.log('Source:', event.source);
    
    if (event.source && event.source.groupId) {
      console.log('>>> FOUND GROUP ID:', event.source.groupId);
      console.log(`Add this to your .env: LINE_GROUP_ID=${event.source.groupId}`);
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
