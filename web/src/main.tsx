import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App as AntApp, ConfigProvider} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './app/App';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={{token: {colorPrimary: '#764ba2'}}}>
      {/* antd App 提供 useApp()（message / notification / modal 的 context 实例），
          海报工作室里的 message 依赖它 */}
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>
);
