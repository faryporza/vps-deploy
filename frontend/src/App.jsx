import { useState, useEffect } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function MascotCloud({ className = '' }) {
  return (
    <svg
      className={`mascot-svg ${className}`}
      viewBox="0 0 180 140"
      role="img"
      aria-label="Cute cloud mascot"
    >
      <path className="mascot-shadow" d="M45 122c16 10 77 10 96 0" />
      <path
        className="cloud-body"
        d="M51 95c-18 0-32-12-32-28 0-15 13-27 30-28 6-18 24-30 47-30 25 0 45 15 49 36 12 4 20 14 20 26 0 15-13 24-31 24H51Z"
      />
      <path className="cloud-cheek left" d="M50 71c0 6 6 11 14 11s14-5 14-11-6-11-14-11-14 5-14 11Z" />
      <path className="cloud-cheek right" d="M108 71c0 6 6 11 14 11s14-5 14-11-6-11-14-11-14 5-14 11Z" />
      <path className="cloud-eye" d="M72 58c0 4-2 7-5 7s-5-3-5-7 2-7 5-7 5 3 5 7Zm44 0c0 4-2 7-5 7s-5-3-5-7 2-7 5-7 5 3 5 7Z" />
      <path className="cloud-mouth" d="M83 71c5 5 14 5 19 0" />
      <path className="sparkle one" d="M28 22l4 8 8 4-8 4-4 8-4-8-8-4 8-4 4-8Z" />
      <path className="sparkle two" d="M148 12l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" />
      <path className="sparkle three" d="M154 104l3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z" />
    </svg>
  );
}

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
        <div className="header-row">
          <div className="header-badge">VPS Deploy</div>
          <div className="status-indicator">
            <span className={`status-dot ${apiStatus}`}></span>
            <span className="status-text">
              {apiStatus === 'online' ? 'Synced' : apiStatus === 'offline' ? 'Offline' : 'Connecting'}
            </span>
          </div>
        </div>
        <div className="hero-content">
          <div>
            <h1>Task Blocks</h1>
            <p className="header-copy">A soft workspace for tracking deploy tasks and backend checks.</p>
          </div>
          <MascotCloud />
        </div>
        <div className="task-metrics" aria-label="Task summary">
          <div>
            <span>{todos.length}</span>
            Total
          </div>
          <div>
            <span>{todos.filter((todo) => todo.completed).length}</span>
            Done
          </div>
          <div>
            <span>{todos.filter((todo) => !todo.completed).length}</span>
            Open
          </div>
        </div>
      </header>

      <main className="app-card">
        <form onSubmit={handleAddTodo} className="todo-form">
          <input
            type="text"
            placeholder="Create a new task block..."
            value={newTodoTitle}
            onChange={(e) => setNewTodoTitle(e.target.value)}
            disabled={apiStatus === 'offline'}
          />
          <button type="submit" disabled={apiStatus === 'offline' || !newTodoTitle.trim()}>
            Add Block
          </button>
        </form>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="loading-state">Loading tasks...</div>
        ) : todos.length === 0 ? (
          <div className="empty-state">
            <MascotCloud className="empty-mascot" />
            <p>No task blocks yet. Create one above.</p>
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
