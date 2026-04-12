import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Layout,
  Menu,
  Avatar,
  Dropdown,
  Space,
  Button,
  Tooltip,
} from '@arco-design/web-react';
import {
  IconMenuFold,
  IconMenuUnfold,
  IconPoweroff,
  IconMoonFill,
  IconSunFill,
} from '@arco-design/web-react/icon';
import { useUserStore } from '@/stores/user';
import BrandMark from '@/components/BrandMark';
import {
  IconStarDashboard,
  IconOrbitTask,
  IconScriptSheet,
  IconVariableNodes,
  IconDependBox,
  IconSubscriptionWave,
  IconLogTrail,
  IconNotifyBell,
  IconConfigOrbit,
} from '@/components/MenuIcons';
import './BasicLayout.css';
import { useThemeMode } from '@/contexts/ThemeContext';

const { Header, Sider, Content } = Layout;
const MenuItem = Menu.Item;

const BasicLayout: React.FC = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [collapsed, setCollapsed] = useState(window.innerWidth < 768);
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useUserStore();
  const { theme, toggleTheme, isSystemTheme } = useThemeMode();

  const menuItems = [
    { key: '/', label: '仪表盘', renderIcon: (active: boolean) => <IconStarDashboard active={active} /> },
    { key: '/tasks', label: '任务管理', renderIcon: (active: boolean) => <IconOrbitTask active={active} /> },
    { key: '/scripts', label: '脚本管理', renderIcon: (active: boolean) => <IconScriptSheet active={active} /> },
    { key: '/env', label: '环境变量', renderIcon: (active: boolean) => <IconVariableNodes active={active} /> },
    { key: '/dependences', label: '依赖管理', renderIcon: (active: boolean) => <IconDependBox active={active} /> },
    { key: '/subscriptions', label: '订阅管理', renderIcon: (active: boolean) => <IconSubscriptionWave active={active} /> },
    { key: '/logs', label: '执行日志', renderIcon: (active: boolean) => <IconLogTrail active={active} /> },
    { key: '/notify', label: '消息推送', renderIcon: (active: boolean) => <IconNotifyBell active={active} /> },
    { key: '/config', label: '系统配置', renderIcon: (active: boolean) => <IconConfigOrbit active={active} /> },
  ];

  const currentMenu = menuItems.find((item) => item.key === location.pathname) || menuItems[0];

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setCollapsed(mobile);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setCollapsed(true);
    }
  }, [location.pathname, isMobile]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const droplist = (
    <Menu>
      <MenuItem key="logout" onClick={handleLogout}>
        <Space>
          <IconPoweroff />
          退出登录
        </Space>
      </MenuItem>
    </Menu>
  );

  return (
    <Layout className="basic-layout">
      <Sider
        collapsed={collapsed}
        collapsible
        trigger={null}
        breakpoint="lg"
        onCollapse={setCollapsed}
        width={200}
        collapsedWidth={isMobile ? 0 : 48}
        className={`layout-sider ${isMobile ? 'layout-sider-mobile' : ''}`}
      >
        <div className="logo">
          <BrandMark collapsed={collapsed} size="sm" center />
        </div>
        <Menu
          collapse={collapsed}
          selectedKeys={[location.pathname]}
          onClickMenuItem={(key) => {
            navigate(key);
            if (isMobile) setCollapsed(true);
          }}
          style={{ width: '100%' }}
        >
          {menuItems.map((item) => {
            const active = location.pathname === item.key;
            return (
              <MenuItem key={item.key}>
                {item.renderIcon(active)}
                <span className="menu-item-label">{item.label}</span>
              </MenuItem>
            );
          })}
        </Menu>
      </Sider>
      {isMobile && !collapsed && <div className="layout-mobile-mask" onClick={() => setCollapsed(true)} />}
      <Layout>
        <Header className="layout-header">
          <div className="header-left">
            <Button
              shape="circle"
              icon={collapsed ? <IconMenuUnfold /> : <IconMenuFold />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <div className="header-page-meta">
              <div className="header-page-title">{currentMenu.label}</div>
            </div>
          </div>
          <div className="header-actions">
            <Tooltip content={isSystemTheme ? `当前跟随系统：${theme === 'dark' ? '暗黑模式' : '明亮模式'}` : theme === 'dark' ? '切换到明亮模式' : '切换到暗黑模式'}>
              <Button
                shape="circle"
                className="theme-toggle-btn"
                icon={theme === 'dark' ? <IconSunFill /> : <IconMoonFill />}
                onClick={toggleTheme}
              />
            </Tooltip>
            <Dropdown droplist={droplist} position="br" trigger="click">
              <Avatar size={34} style={{ cursor: 'pointer', background: 'linear-gradient(135deg, #4f7cff 0%, #8b5cf6 100%)', color: '#fff', fontWeight: 700 }}>
                星
              </Avatar>
            </Dropdown>
          </div>
        </Header>
        <Content className="layout-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default BasicLayout;
