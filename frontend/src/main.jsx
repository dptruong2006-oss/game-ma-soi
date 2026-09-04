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
        <div className="p-10 text-center bg-[#090d16] text-white min-h-screen flex flex-col justify-center items-center font-sans">
          <div className="bg-red-500/10 border border-red-500/30 p-8 rounded-2xl max-w-[450px] shadow-[0_0_30px_rgba(239,68,68,0.2)]">
            <h2 className="text-red-500 text-xl mb-3 font-bold">
              ⚠️ Màn đêm bất ổn - Lỗi giao diện!
            </h2>
            <p className="text-slate-400 mb-6 text-sm leading-relaxed">
              Hệ thống kết nối hoặc hiển thị ván đấu vừa gặp sự cố gián đoạn. Vui lòng tải lại trang để quay lại bàn chơi ngay lập tức.
            </p>
            <button 
              onClick={() => window.location.reload()} 
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg cursor-pointer font-bold text-sm shadow-[0_4px_15px_rgba(124,58,237,0.4)] transition-transform duration-200 hover:scale-105 active:scale-95"
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