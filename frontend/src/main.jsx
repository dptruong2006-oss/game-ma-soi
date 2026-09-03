import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("🐺 [Game ErrorBoundary] Lỗi hiển thị giao diện:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          padding: '40px', 
          textAlign: 'center', 
          background: '#090d16', 
          color: '#fff', 
          minHeight: '100vh', 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'center', 
          alignItems: 'center',
          fontFamily: 'sans-serif'
        }}>
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            padding: '30px',
            borderRadius: '16px',
            maxWidth: '450px',
            boxShadow: '0 0 30px rgba(239, 68, 68, 0.2)'
          }}>
            <h2 style={{ color: '#ef4444', fontSize: '22px', marginBottom: '12px', fontWeight: 'bold' }}>
              ⚠️ Màn đêm bất ổn - Lỗi giao diện!
            </h2>
            <p style={{ color: '#94a3b8', marginBottom: '24px', fontSize: '14px', lineHeight: '1.5' }}>
              Hệ thống kết nối hoặc hiển thị ván đấu vừa gặp sự cố gián đoạn. Vui lòng tải lại trang để quay lại bàn chơi ngay lập tức.
            </p>
            <button 
              onClick={() => window.location.reload()} 
              style={{ 
                padding: '12px 24px', 
                background: 'linear-gradient(135deg, #7c3aed, #db2777)', 
                color: '#fff', 
                border: 'none', 
                borderRadius: '8px', 
                cursor: 'pointer', 
                fontWeight: 'bold', 
                fontSize: '15px',
                boxShadow: '0 4px 15px rgba(124, 58, 237, 0.4)',
                transition: 'transform 0.2s'
              }}
              onMouseOver={(e) => e.target.style.transform = 'scale(1.03)'}
              onMouseOut={(e) => e.target.style.transform = 'scale(1)'}
            >
              🔄 Tải lại ván đấu
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)