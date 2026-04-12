import React, { useMemo, useRef, useState } from 'react';
import {
  Card,
  Tabs,
  Typography,
  Button,
  Space,
  Grid,
  Tag,
  List,
  Select,
  Input,
  Divider,
  Switch,
  Message,
  Form,
  Statistic,
  Checkbox,
  Radio,
  Avatar,
  Collapse,
} from '@arco-design/web-react';
import {
  IconExperiment,
  IconCode,
  IconSave,
  IconNotification,
  IconThunderbolt,
  IconCheckCircleFill,
  IconClockCircle,
  IconMessage,
  IconFile,
  IconFire,
} from '@arco-design/web-react/icon';
import type { Task } from '@/types';
import { taskApi } from '@/api/task';
import { notifyApi, type NotificationChannelConfig, type NotificationEventBindingItem, type NotificationTemplateItem } from '@/api/notify';
import './Notify.css';

const { Title, Text, Paragraph } = Typography;
const TabPane = Tabs.TabPane;
const { Row, Col } = Grid;
const { Option } = Select;
const FormItem = Form.Item;
const CollapseItem = Collapse.Item;

const systemEvents = [
  { key: 'subscription_success', label: '订阅成功', desc: '订阅脚本拉取并处理完成后推送通知。', level: 'success' },
  { key: 'subscription_failed', label: '订阅失败', desc: '订阅更新失败时及时告警。', level: 'danger' },
  { key: 'backup_success', label: '备份成功', desc: '自动备份完成后回传结果。', level: 'success' },
  { key: 'backup_failed', label: '备份失败', desc: '备份异常时立刻提醒。', level: 'danger' },
];

const taskEvents = [
  { key: 'task_success', label: '任务成功', desc: '任务执行正常完成。', level: 'success' },
  { key: 'task_failed', label: '任务失败', desc: '任务退出码非 0 或执行异常。', level: 'danger' },
  { key: 'task_timeout', label: '任务超时', desc: '任务超过执行上限后触发。', level: 'warning' },
];

const variableDescriptions: Record<string, Record<string, string>> = {
  task: {
    task_name: '当前触发通知的任务名称。',
    status_text: '状态说明，例如“执行成功”“执行失败”。',
    status: '任务原始状态值，例如 success / failed / timeout。',
    duration_ms: '任务本次执行耗时，单位毫秒。',
    finished_at: '任务完成时间。',
    output_preview: '实际推送时附带的日志内容。若任务选择“全量推送”，这里是按字数限制截取的原始日志；若选择“精简摘要”，这里会是提取后的关键摘要。',
    output_summary: '始终表示从日志里提取出的关键信息摘要，适合放在模板正文前半段，让通知更易读。',
  },
  subscription: {
    subscription_name: '当前订阅源或订阅任务的名称。',
    status_text: '状态说明，例如“更新成功”“更新失败”。',
    source: '订阅来源，例如 GitHub、GitLab、本地仓库。',
    message: '本次订阅更新结果摘要或错误信息。',
  },
};

const templatePresets = [
  {
    title: '任务通知模板',
    summary: '适合脚本执行、定时任务完成提醒',
    titleValue: '任务 {{task_name}} {{status_text}}',
    bodyValue: '执行状态:{{status}}\n耗时:{{duration_ms}}ms\n执行时间:{{finished_at}}\n摘要:{{output_summary}}\n日志片段:{{output_preview}}',
    vars: ['task_name', 'status_text', 'status', 'duration_ms', 'finished_at', 'output_summary', 'output_preview'],
  },
  {
    title: '订阅通知模板',
    summary: '适合订阅同步与更新结果推送',
    titleValue: '订阅 {{subscription_name}} {{status_text}}',
    bodyValue: '来源:{{source}}\n结果:{{message}}',
    vars: ['subscription_name', 'status_text', 'source', 'message'],
  },
];

const channelPresets = [
  {
    key: 'webhook',
    title: '通用 Webhook',
    desc: '用于系统事件、任务事件、测试推送',
    color: 'arcoblue',
    icon: <IconNotification />,
    status: '已接入',
    category: '自定义回调',
    requiredFields: ['Webhook 地址'],
    presetLabel: '标准 POST 回调',
  },
  {
    key: 'telegram',
    title: 'Telegram',
    desc: 'Bot Token / Chat ID 模式',
    color: 'cyan',
    icon: <IconMessage />,
    status: '已接入',
    category: '即时消息',
    requiredFields: ['Bot Token', 'Chat ID'],
    presetLabel: '官方 Bot API',
  },
  {
    key: 'bark',
    title: 'Bark',
    desc: '适合 iPhone 推送',
    color: 'lime',
    icon: <IconFire />,
    status: '已接入',
    category: '移动推送',
    requiredFields: ['Device Key / URL'],
    presetLabel: 'iOS Bark 推送',
  },
  {
    key: 'ntfy',
    title: 'ntfy',
    desc: '轻量 topic 推送',
    color: 'green',
    icon: <IconNotification />,
    status: '已接入',
    category: '轻量推送',
    requiredFields: ['Topic'],
    presetLabel: '公共 / 自建 ntfy',
  },
  {
    key: 'gotify',
    title: 'Gotify',
    desc: '适合自建推送服务',
    color: 'orange',
    icon: <IconNotification />,
    status: '已接入',
    category: '自建推送',
    requiredFields: ['服务地址', 'App Token'],
    presetLabel: '自建消息中心',
  },
  {
    key: 'wecom',
    title: '企业微信',
    desc: '企业微信机器人 / 应用消息',
    color: 'blue',
    icon: <IconMessage />,
    status: '已接入',
    category: '企业 IM',
    requiredFields: ['机器人 Key'],
    presetLabel: '群机器人',
  },
  {
    key: 'dingtalk',
    title: '钉钉',
    desc: '群机器人 webhook',
    color: 'gold',
    icon: <IconMessage />,
    status: '已接入',
    category: '企业 IM',
    requiredFields: ['Access Token'],
    presetLabel: '群机器人',
  },
  {
    key: 'feishu',
    title: '飞书',
    desc: '飞书群机器人 / webhook',
    color: 'purple',
    icon: <IconMessage />,
    status: '已接入',
    category: '企业 IM',
    requiredFields: ['Hook Token'],
    presetLabel: '群机器人',
  },
  {
    key: 'discord',
    title: 'Discord',
    desc: 'Discord 频道 Webhook 推送',
    color: 'orangered',
    icon: <IconMessage />,
    status: '已接入',
    category: '社区消息',
    requiredFields: ['Webhook ID', 'Webhook Token'],
    presetLabel: '频道 Webhook',
  },
  {
    key: 'slack',
    title: 'Slack',
    desc: 'Slack Incoming Webhook 推送',
    color: 'magenta',
    icon: <IconMessage />,
    status: '已接入',
    category: '团队协作',
    requiredFields: ['Webhook Path'],
    presetLabel: 'Incoming Webhook',
  },
  {
    key: 'serverchan',
    title: 'Server酱',
    desc: 'Server酱 Turbo 微信推送',
    color: 'red',
    icon: <IconFire />,
    status: '已接入',
    category: '微信推送',
    requiredFields: ['SendKey'],
    presetLabel: 'Turbo SendKey',
  },
  {
    key: 'pushplus',
    title: 'PushPlus',
    desc: '微信 / 邮件 / webhook 推送',
    color: 'pinkpurple',
    icon: <IconFire />,
    status: '已接入',
    category: '聚合推送',
    requiredFields: ['Token'],
    presetLabel: 'PushPlus Send API',
  },
  {
    key: 'email',
    title: 'Email',
    desc: 'SMTP 邮件通知',
    color: 'gray',
    icon: <IconFile />,
    status: '已接入',
    category: '邮件通知',
    requiredFields: ['SMTP Host', 'SMTP Port', '用户名', '密码', '收件人'],
    presetLabel: '标准 SMTP',
  },
] as const;

const usageSuggestions = [
  { title: '先测渠道可达性', status: 'success', detail: '保存当前渠道后，优先点一次“测试当前渠道”确认地址、token 或 chat_id 可用。' },
  { title: '先开系统事件，再补任务策略', status: 'warning', detail: '建议先完成系统事件通知，再按需要选择全部任务通知或指定任务通知。' },
  { title: '日志附带只在排障时开启', status: 'info', detail: '失败排查时再附带日志更合适，平时可关闭以减少消息长度和噪音。' },
];

const channelFieldConfigs = {
  webhook: [
    { key: 'display_name', label: '渠道名称', type: 'text', placeholder: '通用 Webhook', description: '给这个通知渠道起一个便于识别的名字。', required: true },
    { key: 'content_type', label: 'Content-Type', type: 'select', options: ['application/json', 'application/x-www-form-urlencoded'], description: '发送测试和正式通知时,请求体使用的内容类型。', required: true },
    { key: 'custom_headers', label: '自定义请求头', type: 'textarea', placeholder: 'X-Token: abc\nX-App: xingshu', description: '额外附带到请求里的 Header,一行一个。' },
  ],
  telegram: [
    { key: 'bot_token', label: 'Bot Token', type: 'password', placeholder: '123456789:AAExampleRealToken', description: 'BotFather 创建机器人后获得的纯 token。不要带 bot 前缀、不要带 < >、不要填完整 URL。', required: true },
    { key: 'chat_id', label: 'Chat ID', type: 'text', placeholder: '-1001234567890', description: '目标用户、群组或频道的纯 chat_id，不要带 < >。', required: true },
    { key: 'parse_mode', label: 'Parse Mode', type: 'select', options: ['Markdown', 'MarkdownV2', 'HTML', 'None'], description: '控制消息正文的格式化解析方式。' },
    { key: 'disable_preview', label: '关闭链接预览', type: 'switch', description: '开启后,消息中的 URL 不再自动展开预览卡片。' },
  ],
  bark: [
    { key: 'device_key', label: 'Device Key / URL', type: 'text', placeholder: 'xxxxxxxx 或 https://api.day.app/xxxx', description: 'Bark App 的设备 key，或完整 Bark 推送地址。', required: true },
    { key: 'sound', label: '提示音', type: 'text', placeholder: 'default / alarm / bell', description: '收到通知时播放的提示音名称。' },
    { key: 'icon', label: '图标 URL', type: 'text', placeholder: 'https://example.com/icon.png', description: '通知卡片里显示的自定义图标地址。' },
    { key: 'group', label: '通知分组', type: 'text', placeholder: 'xingshu', description: '用于在 Bark 中归类同类通知。' },
    { key: 'archive', label: '归档', type: 'switch', description: '开启后通知发送后自动归档。' },
    { key: 'level', label: '提醒级别', type: 'select', options: ['active', 'timeSensitive', 'passive'], description: '控制 Bark 的提醒强度。' },
    { key: 'url', label: '点击跳转 URL', type: 'text', placeholder: 'https://example.com', description: '点击通知后打开的链接。' },
    { key: 'key', label: '加密 Key', type: 'password', placeholder: '可选', description: 'Bark 加密推送使用的 AES Key。' },
    { key: 'iv', label: '加密 IV', type: 'password', placeholder: '可选', description: 'Bark 加密推送使用的初始化向量。' },
  ],
  ntfy: [
    { key: 'topic', label: 'Topic', type: 'text', placeholder: 'xingshu-alerts', description: '要发送到的 ntfy 主题名。', required: true },
    { key: 'token', label: 'Access Token', type: 'password', placeholder: '可选', description: '服务开启鉴权时使用的 Bearer Token。' },
    { key: 'priority', label: '优先级', type: 'select', options: ['1', '2', '3', '4', '5'], description: '通知提醒强度，默认为 3。' },
    { key: 'tags', label: '标签', type: 'text', placeholder: 'warning,robot', description: '通知标签/emoji，多个用逗号分隔。' },
    { key: 'icon', label: '图标 URL', type: 'text', placeholder: 'https://example.com/icon.png', description: '通知头部显示的图标。' },
    { key: 'username', label: '用户名', type: 'text', placeholder: '可选', description: 'Basic Auth 用户名。' },
    { key: 'password', label: '密码', type: 'password', placeholder: '可选', description: 'Basic Auth 密码。' },
    { key: 'actions', label: '动作按钮', type: 'textarea', placeholder: 'view, 打开面板, https://example.com', description: '高级用法：ntfy Actions 头内容。' },
  ],
  gotify: [
    { key: 'server_url', label: '服务地址', type: 'text', placeholder: 'http://gotify.example.com', description: '你的 Gotify 服务根地址。', required: true },
    { key: 'app_token', label: 'App Token', type: 'password', placeholder: '应用 token', description: 'Gotify 应用生成的发送 token。', required: true },
    { key: 'priority', label: '优先级', type: 'select', options: ['1', '3', '5', '8', '10'], description: '消息优先级,影响展示顺序和提醒程度。' },
    { key: 'title_prefix', label: '标题前缀', type: 'text', placeholder: '[星枢]', description: '追加在消息标题前面的统一前缀。' },
  ],
  wecom: [
    { key: 'bot_key', label: '机器人 Key', type: 'text', placeholder: 'webhook key', description: '企业微信群机器人 webhook 中的 key 参数。', required: true },
    { key: 'mentioned_mobile_list', label: '@手机号', type: 'text', placeholder: '多个用逗号分隔', description: '需要在消息中 @ 的手机号列表。' },
    { key: 'mentioned_list', label: '@成员', type: 'text', placeholder: '多个用逗号分隔', description: '需要 @ 的企业微信成员账号列表。' },
    { key: 'msg_type', label: '消息类型', type: 'select', options: ['markdown', 'text'], description: '企业微信机器人发送的消息格式。' },
  ],
  dingtalk: [
    { key: 'access_token', label: 'Access Token', type: 'text', placeholder: '机器人 access_token', description: '钉钉群机器人地址中的 access_token。', required: true },
    { key: 'secret', label: '签名 Secret', type: 'password', placeholder: '可选', description: '启用加签时需要填写的密钥。' },
    { key: 'at_mobiles', label: '@手机号', type: 'text', placeholder: '多个用逗号分隔', description: '需要 @ 的手机号列表。' },
    { key: 'is_at_all', label: '@所有人', type: 'switch', description: '开启后消息会尝试 @ 群内所有人。' },
  ],
  feishu: [
    { key: 'hook_token', label: 'Hook Token', type: 'text', placeholder: '机器人 token', description: '飞书机器人 webhook 地址中的 token。', required: true },
    { key: 'msg_type', label: '消息类型', type: 'select', options: ['text', 'post', 'interactive'], description: '飞书发送内容的消息结构类型。' },
    { key: 'title', label: '卡片标题', type: 'text', placeholder: '星枢通知', description: '飞书卡片或富文本消息的默认标题。' },
    { key: 'tenant_key', label: 'Tenant Key', type: 'text', placeholder: '可选', description: '多租户或企业隔离场景下可用的附加标识。' },
  ],
  discord: [
    { key: 'webhook_id', label: 'Webhook ID', type: 'text', placeholder: '1234567890', description: 'Discord webhook 链接中的 ID 部分。', required: true },
    { key: 'webhook_token', label: 'Webhook Token', type: 'password', placeholder: 'token', description: 'Discord webhook 链接中的 token 部分。', required: true },
    { key: 'username', label: '显示名称', type: 'text', placeholder: 'Xingshu', description: '消息发送时显示的机器人名称。' },
    { key: 'avatar_url', label: '头像 URL', type: 'text', placeholder: 'https://example.com/avatar.png', description: '发送消息时展示的头像地址。' },
  ],
  slack: [
    { key: 'webhook_path', label: 'Webhook Path', type: 'text', placeholder: 'T/B/XXXX', description: 'Slack Incoming Webhook 的路径部分。', required: true },
    { key: 'channel', label: '目标频道', type: 'text', placeholder: '#ops', description: '默认要推送到的频道名。' },
    { key: 'username', label: '显示名称', type: 'text', placeholder: 'Xingshu Bot', description: '消息发送时显示的名称。' },
    { key: 'icon_emoji', label: '图标 Emoji', type: 'text', placeholder: ':robot_face:', description: 'Slack 中显示的机器人 emoji 图标。' },
  ],
  serverchan: [
    { key: 'sendkey', label: 'SendKey', type: 'password', placeholder: 'SCTxxxxxxxx', description: 'Server酱 Turbo 生成的专属 SendKey。', required: true },
    { key: 'channel', label: '推送通道', type: 'text', placeholder: '9|18', description: '限定发送到的设备或渠道组合。' },
    { key: 'openid', label: 'OpenID', type: 'text', placeholder: '可选', description: '指定发送给某个微信用户时填写。' },
    { key: 'short', label: '简短模式', type: 'switch', description: '开启后仅发送较短摘要内容。' },
  ],
  pushplus: [
    { key: 'token', label: 'Token', type: 'password', placeholder: 'pushplus token', description: 'PushPlus 后台生成的发送 token。', required: true },
    { key: 'template', label: '模板类型', type: 'select', options: ['html', 'json', 'markdown', 'txt'], description: '消息正文使用的渲染模板。' },
    { key: 'topic', label: '群组编码', type: 'text', placeholder: '可选', description: '发送到指定群组时填写的 topic 编码。' },
    { key: 'channel', label: '发送渠道', type: 'select', options: ['wechat', 'webhook', 'mail', 'cp'], description: 'PushPlus 的下发目标渠道。' },
    { key: 'webhook', label: '回调 Webhook', type: 'text', placeholder: '可选', description: 'PushPlus 服务端回调地址。' },
    { key: 'callback_url', label: '回调地址', type: 'text', placeholder: '可选', description: '消息下发完成后的回调 URL。' },
    { key: 'to', label: '指定接收者', type: 'text', placeholder: '可选', description: '指定某个接收者或用户标识。' },
  ],
  email: [
    { key: 'smtp_host', label: 'SMTP Host', type: 'text', placeholder: 'smtp.qq.com', description: '邮件服务商提供的 SMTP 服务器地址。', required: true },
    { key: 'smtp_port', label: 'SMTP Port', type: 'text', placeholder: '465 / 587', description: 'SMTP 服务器端口，常见为 465 或 587。', required: true },
    { key: 'username', label: '用户名', type: 'text', placeholder: 'name@example.com', description: '登录 SMTP 时使用的邮箱账号。', required: true },
    { key: 'password', label: 'SMTP 密码/授权码', type: 'password', placeholder: '******', description: '邮箱密码或第三方客户端授权码。', required: true },
    { key: 'from', label: '发件地址', type: 'text', placeholder: 'name@example.com', description: '邮件实际发件地址，不填则默认使用用户名。' },
    { key: 'from_name', label: '发件人名称', type: 'text', placeholder: '星枢通知', description: '收件方看到的发件人名称。' },
    { key: 'to', label: '收件人', type: 'text', placeholder: 'a@example.com,b@example.com', description: '通知接收邮箱，多个地址用逗号分隔。', required: true },
    { key: 'tls', label: '启用 TLS', type: 'switch', description: '开启后通过 TLS/STARTTLS 发送邮件。' },
  ],
} as const;

const webhookAddressPresets = {
  webhook: [
    {
      key: 'generic-webhook',
      label: '通用 Webhook',
      value: 'https://example.com/webhook',
      hint: '适合通用 webhook 接收端',
    },
  ],
  telegram: [
    {
      key: 'telegram-bot-api',
      label: 'Telegram Bot API',
      value: 'https://api.telegram.org',
      hint: '这里只作 API 基址展示；真正发送时请在下方填写纯 Bot Token 和 Chat ID，不要把 <token> 或完整 sendMessage URL 填进去。',
    },
  ],
  bark: [
    {
      key: 'bark-device',
      label: 'Bark 推送地址',
      value: 'https://api.day.app/<device_key>',
      hint: '适合 iPhone Bark 通知',
    },
  ],
  ntfy: [
    {
      key: 'ntfy-topic',
      label: 'ntfy Topic',
      value: 'https://ntfy.sh/<topic>',
      hint: '适合轻量 topic 推送',
    },
  ],
  gotify: [
    {
      key: 'gotify-message',
      label: 'Gotify Message API',
      value: 'http://gotify.example.com/message?token=<app_token>',
      hint: '适合自建推送服务',
    },
  ],
  wecom: [
    {
      key: 'wecom-bot',
      label: '企业微信机器人',
      value: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<key>',
      hint: '群机器人 webhook 地址',
    },
  ],
  dingtalk: [
    {
      key: 'dingtalk-bot',
      label: '钉钉机器人',
      value: 'https://oapi.dingtalk.com/robot/send?access_token=<token>',
      hint: '钉钉群机器人地址',
    },
  ],
  feishu: [
    {
      key: 'feishu-bot',
      label: '飞书机器人',
      value: 'https://open.feishu.cn/open-apis/bot/v2/hook/<token>',
      hint: '飞书群机器人 webhook',
    },
  ],
  discord: [
    {
      key: 'discord-webhook',
      label: 'Discord Webhook',
      value: 'https://discord.com/api/webhooks/<id>/<token>',
      hint: 'Discord 频道 webhook',
    },
  ],
  slack: [
    {
      key: 'slack-webhook',
      label: 'Slack Incoming Webhook',
      value: 'https://hooks.slack.com/services/<token>',
      hint: 'Slack 官方 incoming webhook',
    },
  ],
  serverchan: [
    {
      key: 'serverchan-sendkey',
      label: 'Server酱 SendKey',
      value: 'https://sctapi.ftqq.com/<SendKey>.send',
      hint: 'Server酱 Turbo 推送地址',
    },
  ],
  pushplus: [
    {
      key: 'pushplus-token',
      label: 'PushPlus Token',
      value: 'http://www.pushplus.plus/send?token=<token>',
      hint: 'PushPlus 推送地址',
    },
  ],
  email: [
    {
      key: 'smtp-mailto',
      label: 'SMTP / 邮件通知',
      value: 'smtp://<user>:<pass>@smtp.example.com:587',
      hint: '后续补为完整 SMTP 表单配置',
    },
  ],
} as const;

const getFieldGroup = (channelKey: string, fieldKey: string) => {
  const advancedMap: Record<string, string[]> = {
    webhook: ['custom_headers'],
    telegram: ['parse_mode', 'disable_preview'],
    bark: ['sound', 'icon', 'group', 'archive', 'level', 'url', 'key', 'iv'],
    ntfy: ['token', 'priority', 'tags', 'icon', 'username', 'password', 'actions'],
    gotify: ['priority', 'title_prefix'],
    wecom: ['mentioned_mobile_list', 'mentioned_list', 'msg_type'],
    dingtalk: ['secret', 'at_mobiles', 'is_at_all'],
    feishu: ['msg_type', 'title', 'tenant_key'],
    discord: ['username', 'avatar_url'],
    slack: ['channel', 'username', 'icon_emoji'],
    serverchan: ['channel', 'openid', 'short'],
    pushplus: ['template', 'topic', 'channel', 'webhook', 'callback_url', 'to'],
    email: ['from', 'from_name', 'tls'],
  };

  return (advancedMap[channelKey] || []).includes(fieldKey) ? 'advanced' : 'basic';
};

const channelTestTips: Record<string, { title: string; items: string[] }> = {
  webhook: {
    title: '配置说明',
    items: ['先确认内置地址指向可接收 POST 的 webhook 服务。', '如果目标服务有鉴权,记得补 secret 或自定义请求头。'],
  },
  telegram: {
    title: 'Telegram 配置说明',
    items: ['先填纯 Bot Token 与纯 Chat ID。', '不要填写 <token>、不要带 bot 前缀、不要填写完整 sendMessage URL。', 'Chat ID 不对时,消息通常不会到目标会话。'],
  },
  bark: {
    title: 'Bark 配置说明',
    items: ['先填 Device Key 或完整 Bark URL。', '如果需要更高级的推送样式，可继续补提示音、分组、提醒级别或跳转链接。'],
  },
  ntfy: {
    title: 'ntfy 配置说明',
    items: ['先填 Topic。', '如果你用的是自建 ntfy 服务，可在内置地址里填写自己的服务地址。', '如果服务开启鉴权，再补 Access Token 或 Basic Auth 用户名/密码。'],
  },
  gotify: {
    title: 'Gotify 配置说明',
    items: ['先填服务地址与 App Token。', '确保 Gotify 服务地址可从当前机器访问。'],
  },
  wecom: {
    title: '企业微信配置说明',
    items: ['先填机器人 Key。', '如果需要 @ 人,再补手机号或成员账号。'],
  },
  dingtalk: {
    title: '钉钉配置说明',
    items: ['先填 Access Token。', '如果机器人开启加签,还要补 Secret。'],
  },
  feishu: {
    title: '飞书配置说明',
    items: ['先填 Hook Token。', '如果后续要卡片消息,再补标题和消息类型。'],
  },
  discord: {
    title: 'Discord 配置说明',
    items: ['先填 Webhook ID 与 Webhook Token。', '这类配置方式与 baihu-panel 的 Discord Webhook 思路一致。', '显示名称和头像 URL 可后面再补。'],
  },
  slack: {
    title: 'Slack 配置说明',
    items: ['先填 Webhook Path。', '这类配置方式与 baihu-panel 的 Slack Incoming Webhook 思路一致。', '如果需要指定频道,再补目标频道。'],
  },
  serverchan: {
    title: 'Server酱配置说明',
    items: ['先填 SendKey。', '这类配置方式与 baihu-panel 的 Server酱 Turbo 口径一致。', '其他通道和 OpenID 都是增强项。'],
  },
  pushplus: {
    title: 'PushPlus 配置说明',
    items: ['先填 Token。', '模板类型和发送渠道可以后面再细调。', '如果需要服务端回调或指定接收者，可继续补 webhook / callback_url / to。'],
  },
  email: {
    title: 'Email 配置说明',
    items: ['先填 SMTP Host、Port、用户名、密码、收件人。', '如果希望邮件中显示更友好的发件人名，可补发件人名称。', '如果是 QQ/163/Gmail，一般还需要授权码而不是登录密码。'],
  },
};

const Notify: React.FC = () => {
  const [activeTab, setActiveTab] = useState('channels');
  const [, setTasks] = useState<Task[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('webhook');
  const selectedChannelRef = useRef('webhook');
  const [eventBindings, setEventBindings] = useState<NotificationEventBindingItem[]>([]);
  const [selectedWebhookPresets, setSelectedWebhookPresets] = useState<Record<string, string>>({ webhook: 'generic-webhook' });
  const [templates, setTemplates] = useState<NotificationTemplateItem[]>([]);
  const [templatePreviewMode, setTemplatePreviewMode] = useState<'task' | 'subscription'>('task');
  const [form] = Form.useForm<any>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [channelConfigs, setChannelConfigs] = useState<Record<string, NotificationChannelConfig>>({});
  const [defaultChannel, setDefaultChannel] = useState('webhook');

  const buildChannelPayload = async (): Promise<NotificationChannelConfig> => {
    const values = await form.validate();
    const channelFields = (channelFieldConfigs[selectedChannel as keyof typeof channelFieldConfigs] || []).reduce<Record<string, any>>((acc, field) => {
      acc[String(field.key)] = values[`channel_${selectedChannel}_${field.key}`];
      return acc;
    }, {});

    return {
      channel: selectedChannel,
      enabled: values.enabled ?? false,
      webhook_url: values.webhook_url ?? '',
      secret: values.secret,
      task_events_enabled: values.task_events_enabled ?? true,
      system_events_enabled: values.system_events_enabled ?? true,
      remark: values[`channel_${selectedChannel}_remark`],
      fields: channelFields,
    };
  };

  const loadChannelConfig = React.useCallback(async (channelKey: string) => {
    const config = await notifyApi.getChannelConfig(channelKey);
    setChannelConfigs((prev) => ({ ...prev, [channelKey]: config }));
    const presets = webhookAddressPresets[channelKey as keyof typeof webhookAddressPresets] || webhookAddressPresets.webhook;
    const matchedPreset = presets.find((item) => item.value === (config?.webhook_url ?? ''));
    setSelectedWebhookPresets((prev) => ({ ...prev, [channelKey]: matchedPreset?.key || presets[0]?.key || '' }));

    if (selectedChannelRef.current !== channelKey) {
      return;
    }

    const fieldValues = Object.entries(config?.fields || {}).reduce<Record<string, any>>((acc, [key, value]) => {
      acc[`channel_${channelKey}_${key}`] = value;
      return acc;
    }, {});

    form.resetFields();
    form.setFieldsValue({
      enabled: config?.enabled ?? false,
      webhook_url: config?.webhook_url ?? presets[0]?.value ?? '',
      secret: config?.secret ?? '',
      task_events_enabled: config?.task_events_enabled ?? true,
      system_events_enabled: config?.system_events_enabled ?? true,
      [`channel_${channelKey}_remark`]: config?.remark ?? '',
      ...fieldValues,
    });
  }, [form]);

  React.useEffect(() => {
    const loadData = async () => {
      try {
        const [taskData, channelConfigList, eventBindingsConfig, templatesConfig, settingsConfig] = await Promise.all([
          taskApi.list(),
          notifyApi.listChannelConfigs(),
          notifyApi.getEventBindingsConfig(),
          notifyApi.getTemplatesConfig(),
          notifyApi.getSettingsConfig(),
        ]);
        setTasks(taskData || []);
        setChannelConfigs(Object.fromEntries((channelConfigList || []).map((item) => [item.channel, item])));
        setEventBindings(eventBindingsConfig?.bindings || []);
        setDefaultChannel(settingsConfig?.default_channel || 'webhook');
        setTemplates(templatesConfig?.templates || templatePresets.map((item) => ({
          key: item.title.includes('任务') ? 'task' : 'subscription',
          title: item.title,
          summary: item.summary,
          title_template: item.titleValue,
          body_template: item.bodyValue,
          vars: item.vars,
        })));
      } catch (error) {
        console.error('Failed to load notify page data:', error);
      }
    };
    loadData();
  }, [loadChannelConfig]);

  React.useEffect(() => {
    selectedChannelRef.current = selectedChannel;
    loadChannelConfig(selectedChannel).catch((error) => {
      console.error('Failed to load channel config:', error);
    });
  }, [selectedChannel, loadChannelConfig]);

  const isChannelConfigured = React.useCallback((channelKey: string, currentConfig?: NotificationChannelConfig) => {
    const hasWebhookUrl = !!currentConfig?.webhook_url
      && !(channelKey === 'webhook' && currentConfig.webhook_url === 'https://example.com/webhook')
      && !currentConfig.webhook_url.includes('<token>')
      && !currentConfig.webhook_url.includes('<topic>')
      && !currentConfig.webhook_url.includes('<id>');
    const hasRemark = !!currentConfig?.remark?.trim();
    const hasFieldValues = Object.values(currentConfig?.fields || {}).some((value) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return true;
      return String(value ?? '').trim() !== '';
    });
    return !!currentConfig && (hasWebhookUrl || hasRemark || hasFieldValues);
  }, []);

  const enabledChannelCount = useMemo(
    () => Object.entries(channelConfigs).filter(([channelKey, item]) => !!item?.enabled && isChannelConfigured(channelKey, item)).length,
    [channelConfigs, isChannelConfigured]
  );
  const systemEventEnabledCount = useMemo(
    () => systemEvents.filter((item) => eventBindings.find((binding) => binding.event_key === item.key)?.enabled).length,
    [eventBindings]
  );
  const taskEventEnabledCount = useMemo(
    () => taskEvents.filter((item) => eventBindings.find((binding) => binding.event_key === item.key)?.enabled).length,
    [eventBindings]
  );
  const taskEventSwitch = taskEventEnabledCount > 0;
  const systemEventSwitch = systemEventEnabledCount > 0;

  const availableBindableChannels = useMemo(() => {
    const activeChannels = channelPresets
      .filter((preset) => {
        const cfg = channelConfigs[preset.key];
        return !!cfg?.enabled && isChannelConfigured(preset.key, cfg);
      })
      .map((preset) => preset.key);
    const fallbackChannels = [defaultChannel, 'webhook'];
    return Array.from(new Set([...activeChannels, ...fallbackChannels].filter(Boolean)));
  }, [channelConfigs, defaultChannel, isChannelConfigured]);

  const defaultChannelConfig = channelConfigs[defaultChannel];
  const defaultChannelConfigured = isChannelConfigured(defaultChannel, defaultChannelConfig);
  const enabledChannel = !!defaultChannelConfig?.enabled && defaultChannelConfigured;

  const selectedChannelMeta = channelPresets.find(item => item.key === selectedChannel) || channelPresets[0];
  const channelAddressPresets = webhookAddressPresets[selectedChannel as keyof typeof webhookAddressPresets] || webhookAddressPresets.webhook;
  const selectedWebhookPreset = selectedWebhookPresets[selectedChannel] || channelAddressPresets[0]?.key || '';
  const selectedChannelFields = channelFieldConfigs[selectedChannel as keyof typeof channelFieldConfigs] || [];
  const selectedChannelRequiredFields = selectedChannelFields.filter((field) => 'required' in field && field.required).map((field) => field.label);
  const selectPopupContainer = (node?: HTMLElement | null) => node?.parentElement || document.body;
  const mobileChannelPresets = channelPresets;

  const switchChannel = (channelKey: string) => {
    selectedChannelRef.current = channelKey;
    setSelectedChannel(channelKey);
  };

  const overviewStats = useMemo(() => ([
    {
      label: '已启用渠道',
      value: enabledChannelCount,
      suffix: '个',
      icon: <IconNotification />,
      accent: 'blue',
    },
    {
      label: '系统事件',
      value: systemEventEnabledCount,
      suffix: `/ ${systemEvents.length}`,
      icon: <IconThunderbolt />,
      accent: 'purple',
    },
    {
      label: '任务事件',
      value: taskEventEnabledCount,
      suffix: `/ ${taskEvents.length}`,
      icon: <IconCheckCircleFill />,
      accent: 'green',
    },
    {
      label: '规则预览',
      value: `${eventBindings.filter((item) => item.enabled).length}`,
      suffix: '条',
      icon: <IconClockCircle />,
      accent: 'orange',
    },
  ]), [enabledChannelCount, eventBindings, systemEventEnabledCount, taskEventEnabledCount]);

  const validateChannelPayload = (payload: NotificationChannelConfig) => {
    if (payload.channel !== 'telegram') return;

    const token = String(payload.fields?.bot_token ?? '').trim();
    const chatId = String(payload.fields?.chat_id ?? '').trim();

    if (!token || !chatId) {
      throw new Error('Telegram 需要先填写 Bot Token 和 Chat ID');
    }
    if (token.includes('<') || token.includes('>') || /^token$/i.test(token) || /^<token>$/i.test(token)) {
      throw new Error('Telegram Bot Token 不能带 < >，也不能填写占位符 token');
    }
    if (/^https?:\/\//i.test(token) || token.includes('api.telegram.org')) {
      throw new Error('Telegram Bot Token 只需要填写纯 token，不要填写完整 URL');
    }
    if (token.startsWith('bot')) {
      throw new Error('Telegram Bot Token 不要带 bot 前缀，只填纯 token 即可');
    }
    if (chatId.includes('<') || chatId.includes('>')) {
      throw new Error('Telegram Chat ID 不要带 < >，只填写纯 chat_id');
    }
  };

  const handleSaveWebhook = async () => {
    try {
      const payload = await buildChannelPayload();
      validateChannelPayload(payload);
      setSaving(true);
      await notifyApi.saveChannelConfig(selectedChannel, payload);
      const refreshedConfigs = await notifyApi.listChannelConfigs();
      setChannelConfigs(Object.fromEntries((refreshedConfigs || []).map((item) => [item.channel, item])));
      Message.success('当前渠道配置已保存');
    } catch (error: any) {
      Message.error(error?.message || error?.response?.data || '保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTestWebhook = async () => {
    try {
      const payload = await buildChannelPayload();
      validateChannelPayload(payload);
      setTesting(true);
      await notifyApi.testChannelConfig(selectedChannel, payload);
      Message.success('测试通知发送成功');
    } catch (error: any) {
      Message.error(error?.message || error?.response?.data || '测试通知发送失败');
    } finally {
      setTesting(false);
    }
  };

  const getEventBinding = (eventKey: string) => eventBindings.find((item) => item.event_key === eventKey);

  const updateEventBinding = (eventKey: string, patch: Partial<NotificationEventBindingItem>) => {
    setEventBindings((prev) => {
      const existing = prev.find((item) => item.event_key === eventKey);
      if (!existing) {
        return [...prev, { event_key: eventKey, channel: 'webhook', enabled: false, ...patch }];
      }
      return prev.map((item) => item.event_key === eventKey ? { ...item, ...patch } : item);
    });
  };

  const saveEventBindings = async () => {
    try {
      await notifyApi.saveEventBindingsConfig({ bindings: eventBindings });
      Message.success('事件绑定已保存');
    } catch (error: any) {
      Message.error(error?.response?.data || '保存事件绑定失败');
    }
  };

  const updateTemplate = (key: string, patch: Partial<NotificationTemplateItem>) => {
    setTemplates((prev) => prev.map((item) => item.key === key ? { ...item, ...patch } : item));
  };

  const saveTemplates = async () => {
    try {
      await notifyApi.saveTemplatesConfig({ templates });
      Message.success('推送模板已保存');
    } catch (error: any) {
      Message.error(error?.response?.data || '保存推送模板失败');
    }
  };

  const saveDefaultChannel = async () => {
    try {
      await notifyApi.saveSettingsConfig({ default_channel: defaultChannel });
      Message.success('默认渠道已保存');
    } catch (error: any) {
      Message.error(error?.response?.data || '保存默认渠道失败');
    }
  };

  const previewSamples: Record<string, Record<string, string>> = {
    task: {
      task_name: '每日同步任务',
      status_text: '执行成功',
      status: 'success',
      duration_ms: '1820',
      finished_at: '2026-04-08 23:45:00',
      output_summary: '[INFO] 登录成功\n[INFO] 节点数量：49\n[INFO] Gist 上传完成',
      output_preview: '[INFO] 开始执行\n[INFO] 登录成功\n[INFO] 节点数量：49\n[INFO] Gist 上传完成\n[INFO] 同步完成',
    },
    subscription: {
      subscription_name: '订阅仓库同步',
      status_text: '更新成功',
      source: 'GitHub',
      message: '已拉取最新脚本并完成更新',
    },
  };

  const renderTemplateText = (text: string, vars: Record<string, string>) =>
    text.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);

  return (
    <div className="notify-page">
      <Card bordered={false} className="notify-hero-card">
        <div className="notify-hero">
          <div className="notify-hero-main">
            <Space className="notify-hero-badge" size={8}>
              <IconNotification />
              <span>消息推送中心</span>
            </Space>
            <Title heading={4} style={{ margin: 0 }}>消息推送配置</Title>
            <Paragraph className="notify-hero-desc">
              管理通知渠道、事件绑定、推送模板与测试发送。
            </Paragraph>
          </div>

          <div className="notify-hero-side">
            <Card size="small" className="notify-side-card notify-side-card-highlight">
              <Text className="notify-side-label">当前默认渠道</Text>
              <Title heading={6} style={{ margin: '8px 0 4px' }}>{channelPresets.find((item) => item.key === defaultChannel)?.title || '通用 Webhook'}</Title>
              <Text type="secondary">默认用于系统事件、任务事件与测试发送。</Text>
              <div className="notify-side-tags">
                <Tag color={enabledChannel ? 'green' : 'gray'}>{enabledChannel ? '已启用' : '未启用'}</Tag>
                <Tag color={defaultChannelConfigured ? 'arcoblue' : 'orange'}>{defaultChannelConfigured ? '已配置' : '待配置'}</Tag>
              </div>
            </Card>
          </div>
        </div>
      </Card>

      <Row gutter={[16, 16]} className="notify-overview-row">
        {overviewStats.map((item) => (
          <Col xs={12} lg={6} key={item.label}>
            <Card bordered={false} className={`notify-stat-card accent-${item.accent}`}>
              <div className="notify-stat-icon">{item.icon}</div>
              <Text className="notify-stat-label">{item.label}</Text>
              <Statistic value={Number(item.value)} suffix={item.suffix} className="notify-stat-value" />
            </Card>
          </Col>
        ))}
      </Row>

      <div className="notify-snapshot-strip">
        <div className="notify-snapshot-card">
          <Text className="notify-section-kicker">任务通知</Text>
          <Title heading={6} style={{ margin: '6px 0 4px' }}>按任务单独配置</Title>
          <Text type="secondary">任务通知渠道、事件类型、是否附带日志，请到“任务 → 编辑任务 → 消息推送”中设置。</Text>
        </div>
        <div className="notify-snapshot-card">
          <Text className="notify-section-kicker">全局事件</Text>
          <Title heading={6} style={{ margin: '6px 0 4px' }}>{eventBindings.filter((item) => item.enabled).length} 条已启用</Title>
          <Text type="secondary">这里保存的是系统事件与全局任务事件绑定，不直接覆盖单个任务自己的通知内容。</Text>
        </div>
        <div className="notify-snapshot-card">
          <Text className="notify-section-kicker">默认渠道</Text>
          <Title heading={6} style={{ margin: '6px 0 4px' }}>{channelPresets.find((item) => item.key === defaultChannel)?.title || '通用 Webhook'}</Title>
          <Text type="secondary">{channelPresets.find((item) => item.key === defaultChannel)?.desc || '用于系统事件、任务事件与测试发送。'}</Text>
        </div>
      </div>

      <Card bordered={false} className="notify-page-card">
        <Tabs activeTab={activeTab} onChange={setActiveTab} type="rounded" className="notify-tabs">
          <TabPane key="channels" title="渠道管理">
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={15}>
                <Card size="small" className="notify-panel-card">
                  <div className="notify-section-head">
                    <div>
                      <Text className="notify-section-kicker">渠道</Text>
                      <Title heading={6} style={{ margin: '4px 0 0' }}>渠道管理</Title>
                    </div>
                  </div>

                  <div className="notify-mobile-channel-toolbar">
                    <Text type="secondary">所有通知渠道都直接展示在下方，切换后即可编辑当前渠道配置。</Text>
                  </div>

                  <div className="notify-channel-grid notify-channel-grid-3">
                    {channelPresets.map((channel) => {
                      const active = channel.key === selectedChannel;
                      const currentConfig = channelConfigs[channel.key];
                      const isConfigured = isChannelConfigured(channel.key, currentConfig);
                      const isEnabled = !!currentConfig?.enabled && isConfigured;
                      return (
                        <div
                          key={channel.key}
                          className={`notify-channel-card ${active ? 'notify-channel-card-active' : ''} ${!isConfigured ? 'notify-channel-card-dashed' : ''}`}
                          onClick={() => switchChannel(channel.key)}
                        >
                          <div className="notify-channel-card-head">
                            <Avatar size={36} style={{ backgroundColor: 'var(--color-fill-2)', color: 'inherit' }}>
                              {channel.icon}
                            </Avatar>
                            <Tag color={channel.color}>{channel.status}</Tag>
                          </div>
                          <div>
                            <div className="notify-channel-card-tags">
                              <Tag size="small">{channel.category}</Tag>
                              <Tag size="small" color="gray">{channel.presetLabel}</Tag>
                            </div>
                            <Title heading={6} style={{ margin: '8px 0 6px' }}>{channel.title}</Title>
                            <Text type="secondary">{channel.desc}</Text>
                          </div>
                          <div className="notify-channel-field-summary">
                            {(channel.requiredFields || []).slice(0, 3).map((field) => (
                              <Tag key={field} size="small" color="arcoblue">{field}</Tag>
                            ))}
                            {(channel.requiredFields || []).length > 3 ? <Tag size="small">+{channel.requiredFields.length - 3}</Tag> : null}
                          </div>
                          <div className="notify-channel-meta">
                            <Tag color={active ? 'green' : 'gray'}>{active ? '当前查看' : '点击查看'}</Tag>
                            <Tag color={isEnabled ? 'green' : 'gray'}>{isEnabled ? '已启用' : '未启用'}</Tag>
                            <Tag color={isConfigured ? 'arcoblue' : 'orange'}>{isConfigured ? '已配置' : '待配置'}</Tag>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="notify-channel-mobile-strip">
                    {mobileChannelPresets.map((channel) => {
                      const active = channel.key === selectedChannel;
                      return (
                        <button
                          key={channel.key}
                          type="button"
                          className={`notify-channel-pill ${active ? 'is-active' : ''}`}
                          onClick={() => switchChannel(channel.key)}
                        >
                          <span className="notify-channel-pill-icon">{channel.icon}</span>
                          <span className="notify-channel-pill-text">{channel.title}</span>
                        </button>
                      );
                    })}
                  </div>

                  <Divider style={{ margin: '18px 0' }} />

                  <div className="notify-config-shell">
                    <div className="notify-config-title-row">
                      <div>
                        <Text className="notify-section-kicker">配置</Text>
                        <Title heading={6} style={{ margin: '4px 0 0' }}>渠道配置</Title>
                      </div>
                      <Tag color={selectedChannel === 'webhook' ? 'arcoblue' : 'gray'}>{selectedChannel}</Tag>
                    </div>

                    <div className="notify-test-tip-card">
                      <Text bold>{channelTestTips[selectedChannel]?.title || '配置提示'}</Text>
                      <ul className="notify-test-tip-list">
                        <li>先填写能让该渠道跑起来的核心参数,带 * 的字段需要优先补齐。</li>
                        {(channelTestTips[selectedChannel]?.items || ['先补齐当前渠道的必填字段,再进行测试。']).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    <Form form={form} layout="vertical" requiredSymbol={false}>
                      {selectedChannel === 'webhook' ? (
                        <>
                          <FormItem label="地址预设">
                            <Select
                              value={selectedWebhookPreset}
                              getPopupContainer={selectPopupContainer}
                              onChange={(value) => {
                                const presetKey = String(value);
                                setSelectedWebhookPresets((prev) => ({ ...prev, [selectedChannel]: presetKey }));
                                const preset = channelAddressPresets.find((item) => item.key === presetKey);
                                if (preset) {
                                  form.setFieldValue('webhook_url', preset.value);
                                }
                              }}
                            >
                              {channelAddressPresets.map((item) => (
                                <Option key={item.key} value={item.key}>{item.label}</Option>
                              ))}
                            </Select>
                          </FormItem>
                          <FormItem label="Webhook 地址" field="webhook_url" rules={[{ required: true, message: '请填写 Webhook 地址' }]}>
                            <Input placeholder="https://example.com/webhook" />
                          </FormItem>
                          <Text type="secondary">
                            通用 Webhook 支持直接手填地址,也可以先从预设带入再手动修改。
                          </Text>
                        </>
                      ) : (
                        <>
                          <FormItem label="地址预设">
                            <Select
                              value={selectedWebhookPreset}
                              getPopupContainer={selectPopupContainer}
                              onChange={(value) => {
                                const presetKey = String(value);
                                setSelectedWebhookPresets((prev) => ({ ...prev, [selectedChannel]: presetKey }));
                                const preset = channelAddressPresets.find((item) => item.key === presetKey);
                                if (preset) {
                                  form.setFieldValue('webhook_url', preset.value);
                                }
                              }}
                            >
                              {channelAddressPresets.map((item) => (
                                <Option key={item.key} value={item.key}>{item.label}</Option>
                              ))}
                            </Select>
                          </FormItem>
                          <FormItem label="内置地址" field="webhook_url" rules={[{ required: true, message: '请选择一个地址预设' }]}>
                            <Input readOnly />
                          </FormItem>
                          <Text type="secondary">
                            {channelAddressPresets.find((item) => item.key === selectedWebhookPreset)?.hint}
                          </Text>
                        </>
                      )}

                      <div className="notify-config-group-title">
                        <Text bold>基础配置</Text>
                      </div>

                      <div className="notify-inline-setting">
                        <div>
                          <Text bold>设为默认渠道</Text>
                          <div><Text type="secondary">系统事件、任务事件与测试发送可默认优先使用该渠道。若要替换当前使用中的渠道，建议先备份原配置再切换。</Text></div>
                        </div>
                        <Space>
                          <Switch checked={defaultChannel === selectedChannel} onChange={(checked) => setDefaultChannel(checked ? selectedChannel : 'webhook')} />
                          <Button size="small" type="primary" onClick={saveDefaultChannel}>保存默认渠道</Button>
                        </Space>
                      </div>
                      <div className="notify-channel-fields-grid">
                        {(channelFieldConfigs[selectedChannel as keyof typeof channelFieldConfigs] || [])
                          .filter((field) => getFieldGroup(selectedChannel, String(field.key)) === 'basic')
                          .map((field) => (
                            <div key={field.key} className={field.type === 'textarea' ? 'notify-field-span-full' : ''}>
                              <FormItem
                                label={(
                                  <span className="notify-form-label">
                                    {'required' in field && field.required ? <span className="notify-required-mark">*</span> : null}
                                    {field.label}
                                  </span>
                                )}
                                field={`channel_${selectedChannel}_${field.key}`}
                                extra={field.description}
                                rules={('required' in field && field.required)
                                  ? [{ required: true, message: `请填写${field.label}` }]
                                  : undefined}
                                triggerPropName={field.type === 'switch' ? 'checked' : 'value'}
                              >
                                {field.type === 'select' ? (
                                  <Select placeholder={'placeholder' in field ? String(field.placeholder) : undefined}>
                                    {(field.options || []).map((option) => (
                                      <Option key={option} value={option}>{option}</Option>
                                    ))}
                                  </Select>
                                ) : field.type === 'textarea' ? (
                                  <Input.TextArea placeholder={'placeholder' in field ? String(field.placeholder) : undefined} autoSize={{ minRows: 3, maxRows: 6 }} />
                                ) : field.type === 'password' ? (
                                  <Input.Password placeholder={'placeholder' in field ? String(field.placeholder) : undefined} />
                                ) : field.type === 'switch' ? (
                                  <Switch />
                                ) : (
                                  <Input placeholder={'placeholder' in field ? String(field.placeholder) : undefined} />
                                )}
                              </FormItem>
                            </div>
                          ))}
                      </div>

                      <Collapse bordered={false} className="notify-advanced-collapse">
                        <CollapseItem
                          name="advanced"
                          header={(
                            <div className="notify-config-group-title is-collapse">
                              <span>高级配置</span>
                              <span className="notify-config-group-tip">可选项</span>
                            </div>
                          )}
                        >
                          <div className="notify-channel-fields-grid notify-channel-fields-grid-advanced">
                            {(channelFieldConfigs[selectedChannel as keyof typeof channelFieldConfigs] || [])
                              .filter((field) => getFieldGroup(selectedChannel, String(field.key)) === 'advanced')
                              .map((field) => (
                                <div key={field.key} className={field.type === 'textarea' ? 'notify-field-span-full' : ''}>
                                  <FormItem
                                    label={(
                                      <span className="notify-form-label">
                                        {'required' in field && field.required ? <span className="notify-required-mark">*</span> : null}
                                        {field.label}
                                      </span>
                                    )}
                                    field={`channel_${selectedChannel}_${field.key}`}
                                    extra={field.description}
                                    rules={('required' in field && field.required)
                                      ? [{ required: true, message: `请填写${field.label}` }]
                                      : undefined}
                                    triggerPropName={field.type === 'switch' ? 'checked' : 'value'}
                                  >
                                    {field.type === 'select' ? (
                                      <Select placeholder={'placeholder' in field ? String(field.placeholder) : undefined}>
                                        {(field.options || []).map((option) => (
                                          <Option key={option} value={option}>{option}</Option>
                                        ))}
                                      </Select>
                                    ) : field.type === 'textarea' ? (
                                      <Input.TextArea placeholder={'placeholder' in field ? String(field.placeholder) : undefined} autoSize={{ minRows: 3, maxRows: 6 }} />
                                    ) : field.type === 'password' ? (
                                      <Input.Password placeholder={'placeholder' in field ? String(field.placeholder) : undefined} />
                                    ) : field.type === 'switch' ? (
                                      <Switch />
                                    ) : (
                                      <Input placeholder={'placeholder' in field ? String(field.placeholder) : undefined} />
                                    )}
                                  </FormItem>
                                </div>
                              ))}
                          </div>
                        </CollapseItem>
                      </Collapse>

                      <Row gutter={12}>
                        <Col xs={24} md={12}>
                          <FormItem label="启用渠道" field="enabled" triggerPropName="checked">
                            <Switch />
                          </FormItem>
                        </Col>
                        <Col xs={24} md={12}>
                          <FormItem label="渠道备注" field={`channel_${selectedChannel}_remark`}>
                            <Input placeholder="例如:生产环境告警 / 个人通知" />
                          </FormItem>
                        </Col>
                      </Row>
                      <Row gutter={12}>
                        <Col xs={24} md={12}>
                          <FormItem label="任务事件通知" field="task_events_enabled" triggerPropName="checked">
                            <Switch />
                          </FormItem>
                        </Col>
                        <Col xs={24} md={12}>
                          <FormItem label="系统事件通知" field="system_events_enabled" triggerPropName="checked">
                            <Switch />
                          </FormItem>
                        </Col>
                      </Row>

                      <div className="notify-config-actions">
                        <Button type="primary" icon={<IconSave />} loading={saving} onClick={handleSaveWebhook}>
                          保存当前渠道
                        </Button>
                        <Button icon={<IconExperiment />} loading={testing} onClick={handleTestWebhook}>
                          测试当前渠道
                        </Button>
                      </div>
                    </Form>
                  </div>
                </Card>
              </Col>

              <Col xs={24} xl={9}>
                <Card size="small" className="notify-panel-card">
                  <div className="notify-section-head">
                    <div>
                      <Text className="notify-section-kicker">规则预览</Text>
                      <Title heading={6} style={{ margin: '4px 0 0' }}>通知规则预览</Title>
                    </div>
                  </div>
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <div className="notify-note-block">
                      <Text bold>当前查看渠道</Text>
                      <div className="notify-channel-mini">
                        <Avatar size={32} style={{ backgroundColor: 'var(--color-fill-2)', color: 'inherit' }}>
                          {selectedChannelMeta.icon}
                        </Avatar>
                        <div>
                          <div><Text bold>{selectedChannelMeta.title}</Text></div>
                          <Text type="secondary">{selectedChannelMeta.desc}</Text>
                        </div>
                      </div>
                      <div className="notify-tag-row">
                        <Tag>{selectedChannelMeta.category}</Tag>
                        <Tag color="gray">{selectedChannelMeta.presetLabel}</Tag>
                        <Tag color="green">{selectedChannelMeta.status}</Tag>
                      </div>
                    </div>
                    <div className="notify-note-block">
                      <Text bold>预设字段</Text>
                      <Text type="secondary">这个渠道当前推荐优先补齐以下核心字段，再做测试发送。</Text>
                      <div className="notify-tag-row">
                        {(selectedChannelRequiredFields.length ? selectedChannelRequiredFields : selectedChannelMeta.requiredFields).map((field) => (
                          <Tag key={field} color="arcoblue">{field}</Tag>
                        ))}
                      </div>
                    </div>
                    <div className="notify-note-block">
                      <Text bold>地址预设</Text>
                      <Text type="secondary">当前预设：{channelAddressPresets.find((item) => item.key === selectedWebhookPreset)?.label || '未选择'}</Text>
                      <div className="notify-code-box notify-code-box-compact">{channelAddressPresets.find((item) => item.key === selectedWebhookPreset)?.value || '未配置地址预设'}</div>
                    </div>
                    <div className="notify-note-block">
                      <Text bold>请求头</Text>
                      <div className="notify-tag-row">
                        <Tag>X-Xingshu-Webhook-Secret</Tag>
                      </div>
                    </div>
                    <div className="notify-note-block">
                      <Text bold>事件类型示例</Text>
                      <div className="notify-tag-row">
                        <Tag>task.finished</Tag>
                        <Tag>subscription.finished</Tag>
                        <Tag>backup.finished</Tag>
                        <Tag>notification.test</Tag>
                      </div>
                    </div>
                    <div className="notify-note-block">
                      <Text bold>当前规则摘要</Text>
                      <Text type="secondary">当前已启用 {eventBindings.filter((item) => item.enabled).length} 条事件绑定（系统 {systemEventEnabledCount} / 任务 {taskEventEnabledCount}）。</Text>
                      <div className="notify-tag-row">
                        {eventBindings.filter((item) => item.enabled).slice(0, 6).map((item) => (
                          <Tag key={item.event_key} color="arcoblue">{item.event_key} → {item.channel}</Tag>
                        ))}
                      </div>
                    </div>
                  </Space>
                </Card>
              </Col>
            </Row>
          </TabPane>

          <TabPane key="events" title="事件绑定">
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={14}>
                <Card size="small" className="notify-panel-card">
                  <div className="notify-section-head">
                    <div>
                      <Text className="notify-section-kicker">SYSTEM EVENTS</Text>
                      <Title heading={6} style={{ margin: '4px 0 0' }}>系统事件绑定</Title>
                    </div>
                    <Tag color={systemEventSwitch ? 'green' : 'gray'}>{systemEventSwitch ? '已启用' : '已关闭'}</Tag>
                  </div>
                  <div className="notify-binding-grid">
                    {systemEvents.map((item) => {
                      const binding = getEventBinding(item.key) || { event_key: item.key, channel: 'webhook', enabled: false };
                      const active = binding.enabled;
                      return (
                        <div key={item.key} className={`notify-binding-card ${active ? 'is-active' : ''}`}>
                          <div className="notify-binding-card-top">
                            <Space>
                              <Text bold>{item.label}</Text>
                              <Tag size="small" color={item.level === 'danger' ? 'red' : 'green'}>{item.key}</Tag>
                            </Space>
                            <Checkbox
                              checked={active}
                              onChange={(checked) => updateEventBinding(item.key, { enabled: checked })}
                            />
                          </div>
                          <Paragraph className="notify-binding-desc">{item.desc}</Paragraph>
                          <div className="notify-binding-foot">
                            <Select
                              value={binding.channel}
                              size="small"
                              style={{ width: 180 }}
                              getPopupContainer={selectPopupContainer}
                              onChange={(value) => updateEventBinding(item.key, { channel: String(value) })}
                            >
                              {availableBindableChannels.map((channelKey) => (
                                <Option key={channelKey} value={channelKey}>{channelPresets.find((item) => item.key === channelKey)?.title || channelKey}</Option>
                              ))}
                            </Select>
                            <Text type="secondary">选择该事件触发时使用的渠道</Text>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="notify-config-actions">
                    <Button type="primary" icon={<IconSave />} onClick={saveEventBindings}>保存系统事件绑定</Button>
                  </div>
                </Card>
              </Col>

              <Col xs={24} xl={10}>
                <Card size="small" className="notify-panel-card">
                  <div className="notify-section-head">
                    <div>
                      <Text className="notify-section-kicker">TASK EVENTS</Text>
                      <Title heading={6} style={{ margin: '4px 0 0' }}>任务事件策略</Title>
                    </div>
                    <Tag color={taskEventSwitch ? 'green' : 'gray'}>{taskEventSwitch ? '已启用' : '已关闭'}</Tag>
                  </div>

                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Card bordered={false} style={{ background: 'var(--color-fill-2)' }}>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        <Text bold>说明</Text>
                        <Text type="secondary">
                          这里配置的是全局任务事件绑定：决定 task_success / task_failed / task_timeout 这些事件默认发到哪个渠道。
                        </Text>
                        <Text type="secondary">
                          如果你要给某一个具体任务单独勾选“附带执行日志”、设置日志长度或单独渠道，请到「任务 → 编辑任务 → 消息推送」里配置。
                        </Text>
                      </Space>
                    </Card>

                    <div className="notify-check-list">
                      {taskEvents.map((item) => {
                        const binding = getEventBinding(item.key) || { event_key: item.key, channel: 'webhook', enabled: false };
                        const active = binding.enabled;
                        return (
                          <div key={item.key} className={`notify-check-item ${active ? 'is-active' : ''}`}>
                            <div>
                              <Space>
                                <Text bold>{item.label}</Text>
                                <Tag size="small" color={item.level === 'danger' ? 'red' : item.level === 'warning' ? 'orange' : 'green'}>{item.key}</Tag>
                              </Space>
                              <Paragraph className="notify-binding-desc">{item.desc}</Paragraph>
                              <div className="notify-binding-foot" style={{ marginTop: 12 }}>
                                <Select
                                  value={binding.channel}
                                  size="small"
                                  style={{ width: 180 }}
                                  getPopupContainer={selectPopupContainer}
                                  onChange={(value) => updateEventBinding(item.key, { channel: String(value) })}
                                >
                                  {availableBindableChannels.map((channelKey) => (
                                    <Option key={channelKey} value={channelKey}>{channelPresets.find((item) => item.key === channelKey)?.title || channelKey}</Option>
                                  ))}
                                </Select>
                                <Text type="secondary">选择任务事件使用的通知渠道</Text>
                              </div>
                            </div>
                            <Checkbox
                              checked={active}
                              onChange={(checked) => updateEventBinding(item.key, { enabled: checked })}
                            />
                          </div>
                        );
                      })}
                    </div>

                    <Divider style={{ margin: 0 }} />
                    <div className="notify-config-actions">
                      <Button type="primary" icon={<IconSave />} onClick={saveEventBindings}>保存任务事件策略</Button>
                    </div>
                  </Space>
                </Card>
              </Col>
            </Row>
          </TabPane>

          <TabPane key="templates" title="推送模板">
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={16}>
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  {templates.map((item) => (
                    <Card size="small" className="notify-panel-card notify-template-card" key={item.key}>
                      <Text className="notify-section-kicker">模板</Text>
                      <Title heading={6} style={{ margin: '6px 0 4px' }}>{item.title}</Title>
                      <Text type="secondary">{item.summary}</Text>
                      <Divider style={{ margin: '16px 0' }} />
                      <div className="notify-template-block">
                        <Text bold>标题模板</Text>
                        <Input
                          value={item.title_template}
                          onChange={(value) => updateTemplate(item.key, { title_template: value })}
                          placeholder="例如: 任务 {{task_name}} {{status_text}}"
                        />
                      </div>
                      <div className="notify-template-block">
                        <Text bold>正文模板</Text>
                        <Input.TextArea
                          value={item.body_template}
                          onChange={(value) => updateTemplate(item.key, { body_template: value })}
                          autoSize={{ minRows: 4, maxRows: 8 }}
                          placeholder="例如: 执行状态:{{status}}"
                        />
                      </div>
                      <div className="notify-template-vars">
                        {item.vars.map((v) => <Tag key={v}>{`{{${v}}}`}</Tag>)}
                      </div>
                      <Divider style={{ margin: '16px 0' }} />
                      <div className="notify-template-block">
                        <Text bold>效果预览</Text>
                        <div className="notify-code-box">
                          {renderTemplateText(item.title_template || '', previewSamples[item.key as 'task' | 'subscription'] || previewSamples.task)}
                        </div>
                        <div className="notify-code-box multiline" style={{ marginTop: 10 }}>
                          {renderTemplateText(item.body_template || '', previewSamples[item.key as 'task' | 'subscription'] || previewSamples.task)}
                        </div>
                      </div>
                    </Card>
                  ))}
                  <div className="notify-config-actions">
                    <Button type="primary" icon={<IconSave />} onClick={saveTemplates}>保存推送模板</Button>
                  </div>
                </Space>
              </Col>
              <Col xs={24} xl={8}>
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card size="small" className="notify-panel-card">
                    <Text className="notify-section-kicker">变量</Text>
                    <Title heading={6} style={{ margin: '6px 0 12px' }}>变量与自定义说明</Title>
                    <Text type="secondary">你可以在标题模板和正文模板中使用形如 <code>{'{{task_name}}'}</code> 的变量。保存后，通知内容会按变量自动替换。</Text>
                    <Radio.Group value={templatePreviewMode} onChange={(value) => setTemplatePreviewMode(value as 'task' | 'subscription')} type="button" style={{ margin: '12px 0' }}>
                      <Radio value="task">任务变量</Radio>
                      <Radio value="subscription">订阅变量</Radio>
                    </Radio.Group>
                    <div className="notify-vars-list" style={{ marginTop: 12 }}>
                      {(templates.find((item) => item.key === templatePreviewMode)?.vars || []).map((item) => (
                        <div key={item} className="notify-var-item">
                          <Tag>{`{{${item}}}`}</Tag>
                          <Text type="secondary">{variableDescriptions[templatePreviewMode]?.[item] || '当前模板可直接引用该变量。'}</Text>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Space>
              </Col>
            </Row>
          </TabPane>

          <TabPane key="api" title="脚本调用">
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={14}>
                <Card size="small" className="notify-panel-card">
                  <div className="notify-section-head">
                    <div>
                      <Text className="notify-section-kicker">脚本调用</Text>
                      <Title heading={6} style={{ margin: '4px 0 0' }}>脚本调用示例</Title>
                    </div>
                    <IconCode />
                  </div>
                  <div className="notify-code-box multiline">
{`curl -X POST https://your-webhook.example.com \\
  -H "Content-Type: application/json" \\
  -H "X-Xingshu-Webhook-Secret: <secret>" \\
  -d '{
    "event_type": "notification.test",
    "category": "system",
    "status": "success",
    "message": "这是一条来自星枢的测试通知。"
  }'`}
                  </div>
                  <Space style={{ marginTop: 16 }}>
                    <Button icon={<IconExperiment />} loading={testing} onClick={handleTestWebhook}>发送测试通知</Button>
                  </Space>
                </Card>
              </Col>
              <Col xs={24} xl={10}>
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card size="small" className="notify-panel-card">
                    <Text className="notify-section-kicker">建议</Text>
                    <Title heading={6} style={{ margin: '6px 0 12px' }}>使用建议</Title>
                    <List
                      dataSource={[
                        '先确认默认渠道，再按需打开系统事件或任务事件通知。',
                        'Webhook、Telegram 等渠道建议先用“测试当前渠道”确认可达。',
                        '任务事件若只想提醒某一个任务，可切到“指定任务通知”。',
                        '附带执行日志适合排查失败场景，日志长度建议按渠道限制控制。',
                      ]}
                      render={(item) => <List.Item>{item}</List.Item>}
                    />
                  </Card>

                  <Card size="small" className="notify-panel-card">
                    <Text className="notify-section-kicker">提醒</Text>
                    <Title heading={6} style={{ margin: '6px 0 12px' }}>配置提醒</Title>
                    <div className="notify-activity-list">
                      {usageSuggestions.map((item) => (
                        <div key={item.title} className="notify-activity-item">
                          <div className={`notify-activity-dot is-${item.status}`} />
                          <div>
                            <div><Text bold>{item.title}</Text></div>
                            <div><Text type="secondary">{item.detail}</Text></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Space>
              </Col>
            </Row>
          </TabPane>
        </Tabs>
      </Card>

    </div>
  );
};

export default Notify;
