import request from '@/utils/request';

export interface NotificationWebhookConfig {
  enabled: boolean;
  webhook_url: string;
  secret?: string;
  task_events_enabled?: boolean;
  system_events_enabled?: boolean;
}

export interface NotificationChannelConfig {
  channel: string;
  enabled: boolean;
  webhook_url: string;
  secret?: string;
  task_events_enabled?: boolean;
  system_events_enabled?: boolean;
  remark?: string;
  fields?: Record<string, any>;
}

export interface NotificationEventBindingItem {
  event_key: string;
  channel: string;
  enabled: boolean;
}

export interface NotificationEventBindingsConfig {
  bindings: NotificationEventBindingItem[];
}

export interface NotificationTemplateItem {
  key: string;
  title: string;
  summary: string;
  title_template: string;
  body_template: string;
  vars: string[];
}

export interface NotificationTemplatesConfig {
  templates: NotificationTemplateItem[];
}

export interface NotificationSettingsConfig {
  default_channel: string;
}

export const notifyApi = {
  getWebhookConfig: () => request.get<NotificationWebhookConfig>('/configs/notification-webhook/config'),
  saveWebhookConfig: (data: NotificationWebhookConfig) => request.post('/configs/notification-webhook/config', data),
  testWebhookConfig: (data: NotificationWebhookConfig) => request.post('/configs/notification-webhook/test', data),
  listChannelConfigs: () => request.get<NotificationChannelConfig[]>('/configs/notification-channels'),
  getChannelConfig: (channel: string) => request.get<NotificationChannelConfig>(`/configs/notification-channels/${channel}/config`),
  saveChannelConfig: (channel: string, data: NotificationChannelConfig) => request.post(`/configs/notification-channels/${channel}/config`, data),
  testChannelConfig: (channel: string, data: NotificationChannelConfig) => request.post(`/configs/notification-channels/${channel}/test`, data),
  getEventBindingsConfig: () => request.get<NotificationEventBindingsConfig>('/configs/notification-event-bindings/config'),
  saveEventBindingsConfig: (data: NotificationEventBindingsConfig) => request.post('/configs/notification-event-bindings/config', data),
  getTemplatesConfig: () => request.get<NotificationTemplatesConfig>('/configs/notification-templates/config'),
  saveTemplatesConfig: (data: NotificationTemplatesConfig) => request.post('/configs/notification-templates/config', data),
  getSettingsConfig: () => request.get<NotificationSettingsConfig>('/configs/notification-settings/config'),
  saveSettingsConfig: (data: NotificationSettingsConfig) => request.post('/configs/notification-settings/config', data),
};
