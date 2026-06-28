import { useState, useEffect } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function App() {
  const [todos, setTodos] = useState([]);
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [apiStatus, setApiStatus] = useState('connecting');

  // Check API health and fetch initial todos
  useEffect(() => {
    const fetchTodos = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/todos`);
        if (!res.ok) {
          throw new Error('Failed to fetch todos');
        }
        const data = await res.json();
        setTodos(data);
        setApiStatus('online');
        setError(null);
      } catch (err) {
        console.error(err);
        setError('Cannot connect to the backend server.');
        setApiStatus('offline');
      } finally {
        setLoading(false);
      }
    };

    fetchTodos();
  }, []);

  // Add a new todo item
  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!newTodoTitle.trim()) return;

    try {
      const res = await fetch(`${API_URL}/api/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: newTodoTitle }),
      });

      if (!res.ok) {
        throw new Error('Failed to create todo');
      }

      const createdTodo = await res.json();
      setTodos((prev) => [createdTodo, ...prev]);
      setNewTodoTitle('');
    } catch (err) {
      console.error(err);
      alert('Failed to add todo. Please try again.');
    }
  };

  // Toggle todo completed status
  const handleToggleComplete = async (id, currentCompleted) => {
    try {
      // Optimistic update
      setTodos((prev) =>
        prev.map((todo) =>
          todo.id === id ? { ...todo, completed: !currentCompleted } : todo
        )
      );

      const res = await fetch(`${API_URL}/api/todos/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ completed: !currentCompleted }),
      });

      if (!res.ok) {
        throw new Error('Failed to update status');
      }
    } catch (err) {
      console.error(err);
      // Revert on error
      setTodos((prev) =>
        prev.map((todo) =>
          todo.id === id ? { ...todo, completed: currentCompleted } : todo
        )
      );
      alert('Failed to update todo status.');
    }
  };

  // Delete a todo item
  const handleDeleteTodo = async (id) => {
    try {
      // Optimistic delete
      const previousTodos = [...todos];
      setTodos((prev) => prev.filter((todo) => todo.id !== id));

      const res = await fetch(`${API_URL}/api/todos/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete todo');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to delete todo.');
      // Revert if error
      // Refresh list to sync
      const res = await fetch(`${API_URL}/api/todos`);
      if (res.ok) {
        const data = await res.json();
        setTodos(data);
      }
    }
  };

  return (
    <div className="todo-app-container">
      <header className="app-header">
        <div className="header-badge">VPS & Docker MySQL Demo</div>
        <h1>📋 Tasks Manager</h1>
        <div className="status-indicator">
          <span className={`status-dot ${apiStatus}`}></span>
          <span className="status-text">
            Backend API is {apiStatus === 'online' ? 'Online' : apiStatus === 'offline' ? 'Offline' : 'Connecting...'}
          </span>
        </div>
      </header>

      <main className="app-card">
        <form onSubmit={handleAddTodo} className="todo-form">
          <input
            type="text"
            placeholder="Add a new task..."
            value={newTodoTitle}
            onChange={(e) => setNewTodoTitle(e.target.value)}
            disabled={apiStatus === 'offline'}
          />
          <button type="submit" disabled={apiStatus === 'offline' || !newTodoTitle.trim()}>
            Add Task
          </button>
        </form>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="loading-state">Loading tasks...</div>
        ) : todos.length === 0 ? (
          <div className="empty-state">
            <p>No tasks yet. Create one above to get started!</p>
          </div>
        ) : (
          <ul className="todo-list">
            {todos.map((todo) => (
              <li key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                <label className="checkbox-container">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => handleToggleComplete(todo.id, todo.completed)}
                  />
                  <span className="checkmark"></span>
                </label>
                <span className="todo-title">{todo.title}</span>
                <button
                  type="button"
                  className="delete-btn"
                  onClick={() => handleDeleteTodo(todo.id)}
                  aria-label="Delete todo"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="app-footer">
        <p>Built with React + Express + Prisma + MySQL & Docker</p>
      </footer>
    </div>
  );
}

export default App;
