import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import '@arco-design/web-react/dist/css/arco.css';
import './index.css';
import router from './router';
import { ThemeProvider } from './contexts/ThemeContext';

const savedTheme = localStorage.getItem('xingshu-theme');
const initialTheme = savedTheme === 'light' || savedTheme === 'dark'
  ? savedTheme
  : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

document.body.setAttribute('arco-theme', initialTheme);
document.documentElement.setAttribute('data-theme', initialTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>
);
