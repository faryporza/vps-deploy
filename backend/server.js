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
async function sendLineMessage(messageText) {
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

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to: groupId,
        messages: [
          {
            type: 'text',
            text: messageText
          }
        ]
      })
    });

    if (!response.ok) {
      console.error('Failed to send LINE message:', response.status, await response.text());
    } else {
      console.log('Successfully sent LINE notification');
    }
  } catch (error) {
    console.error('Error in sendLineMessage:', error);
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
  const { title, dueDate, notifyBeforeMinutes } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const newTodo = await prisma.todo.create({
      data: {
        title: title.trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        notifyBeforeMinutes: notifyBeforeMinutes !== undefined ? parseInt(notifyBeforeMinutes) : 0,
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
  const { title, completed, dueDate, notifyBeforeMinutes } = req.body;

  try {
    const todoId = parseInt(id);
    if (isNaN(todoId)) {
      return res.status(400).json({ error: 'Invalid todo ID' });
    }

    const dataToUpdate = {};
    if (title !== undefined) dataToUpdate.title = title.trim();
    if (completed !== undefined) dataToUpdate.completed = completed;
    
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
    // Find open todos that have a dueDate and have not been notified yet
    const pendingTodos = await prisma.todo.findMany({
      where: {
        completed: false,
        isNotified: false,
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
        let message = `\n⏰ แจ้งเตือนกำหนดส่งงาน!\n📌 งาน: ${todo.title}\n📅 ครบกำหนด: ${thaiTime}`;
        
        if (todo.notifyBeforeMinutes > 0) {
          message += `\n(ล่วงหน้า ${todo.notifyBeforeMinutes} นาที)`;
        }

        await sendLineMessage(message);

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
