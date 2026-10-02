import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {ConfigProvider} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './app/App';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={{token: {colorPrimary: '#764ba2'}}}>
      <App />
    </ConfigProvider>
  </StrictMode>
);
