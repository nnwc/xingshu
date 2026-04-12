import React, { useEffect, useState } from 'react';

const MOBILE_VALUE_PREVIEW_LINES = 6;
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Message,
  Popconfirm,
  Switch,
  Typography,
} from '@arco-design/web-react';
import { IconPlus, IconEdit, IconDelete } from '@arco-design/web-react/icon';
import { envApi } from '@/api/env';
import type { EnvVar } from '@/types';
import './Env.css';

const FormItem = Form.Item;
const Env: React.FC = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [expandedValueKeys, setExpandedValueKeys] = useState<Record<number, boolean>>({});

  // 全局变量
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [editingEnv, setEditingEnv] = useState<EnvVar | null>(null);
  const [form] = Form.useForm();


  useEffect(() => {
    loadEnvVars();

    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const loadEnvVars = async () => {
    setLoading(true);
    try {
      const res: any = await envApi.list();
      setEnvVars(res);
    } finally {
      setLoading(false);
    }
  };


  const handleAdd = () => {
    setEditingEnv(null);
    form.resetFields();
    setVisible(true);
  };

  const handleEdit = (env: EnvVar) => {
    setEditingEnv(env);
    form.setFieldsValue(env);
    setVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validate();

      if (editingEnv) {
        await envApi.update(editingEnv.id, values);
        Message.success('变量更新成功');
      } else {
        await envApi.create(values);
        Message.success('变量创建成功');
      }
      setVisible(false);
      loadEnvVars();
    } catch (error: any) {
      Message.error(error.response?.data?.error || '操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await envApi.delete(id);
      Message.success('删除成功');
      loadEnvVars();
    } catch (error: any) {
      Message.error(error.response?.data?.error || '删除失败');
    }
  };


  const globalColumns = [
    {
      title: '变量名',
      dataIndex: 'key',
      width: 200,
      render: (key: string) => (
        <span className="env-key-text" style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{key}</span>
      ),
    },
    {
      title: '变量值',
      dataIndex: 'value',
      width: 300,
      ellipsis: true,
      render: (value: string) => (
        <span className="env-value-text" style={{ fontFamily: 'monospace', fontSize: '12px' }}>{value}</span>
      ),
    },
    {
      title: '描述',
      dataIndex: 'remark',
      ellipsis: true,
    },
    {
      title: '标签',
      dataIndex: 'tag',
      width: 140,
      render: (tag: string) => tag || '-',
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 100,
      render: (enabled: boolean, record: EnvVar) => (
        <Switch
          checked={enabled}
          onChange={async (checked) => {
            try {
              await envApi.update(record.id, { enabled: checked });
              Message.success(checked ? '已启用' : '已禁用');
              loadEnvVars();
            } catch (error: any) {
              Message.error(error.response?.data?.error || '操作失败');
            }
          }}
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (time: string) => new Date(time).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 150,
      fixed: 'right' as const,
      render: (_: any, record: EnvVar) => (
        <Space>
          <Button type="text" size="small" icon={<IconEdit />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除这个变量吗？" onOk={() => handleDelete(record.id)}>
            <Button type="text" size="small" status="danger" icon={<IconDelete />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="env-page-hero">
        <div className="env-page-description">统一管理运行变量、配置值与启用状态</div>
      </div>
      <Card className="env-page-card">
      <div className="env-toolbar" style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<IconPlus />} onClick={handleAdd}>
          新建变量
        </Button>
      </div>

      {isMobile ? (
        <div className="env-mobile-list">
          {envVars.map((item) => (
            <Card key={item.id} size="small" bordered className="env-mobile-card">
              <div style={{ width: '100%', overflow: 'hidden' }}>
                <div style={{ marginBottom: 8 }}>
                  <Typography.Text bold style={{ fontFamily: 'monospace', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                    {item.key}
                  </Typography.Text>
                </div>

                <div className="env-mobile-value-block" style={{ marginBottom: 10, padding: '10px', borderRadius: 8, overflow: 'hidden' }}>
                  <Typography.Paragraph
                    copyable
                    style={{
                      marginBottom: 0,
                      fontFamily: 'monospace',
                      fontSize: 12,
                      lineHeight: 1.6,
                      wordBreak: 'break-all',
                      overflowWrap: 'anywhere',
                      whiteSpace: 'pre-wrap',
                      maxWidth: '100%',
                      display: '-webkit-box',
                      WebkitLineClamp: expandedValueKeys[item.id] ? 'unset' : MOBILE_VALUE_PREVIEW_LINES,
                      WebkitBoxOrient: 'vertical',
                      overflow: expandedValueKeys[item.id] ? 'visible' : 'hidden',
                    }}
                  >
                    {item.value}
                  </Typography.Paragraph>
                  {item.value && item.value.split('\n').length > MOBILE_VALUE_PREVIEW_LINES && (
                    <Button
                      type="text"
                      size="mini"
                      style={{ marginTop: 6, paddingLeft: 0 }}
                      onClick={() => setExpandedValueKeys((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                    >
                      {expandedValueKeys[item.id] ? '收起' : '展开更多'}
                    </Button>
                  )}
                </div>

                {(item.remark || item.tag) && (
                  <div style={{ marginBottom: 10 }}>
                    {item.remark ? (
                      <Typography.Text type="secondary" style={{ display: 'block', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                        描述：{item.remark}
                      </Typography.Text>
                    ) : null}
                    {item.tag ? (
                      <Typography.Text type="secondary" style={{ display: 'block', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                        标签：{item.tag}
                      </Typography.Text>
                    ) : null}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <Switch
                      checked={item.enabled}
                      checkedText="启用"
                      uncheckedText="禁用"
                      onChange={async (checked) => {
                        try {
                          await envApi.update(item.id, { enabled: checked });
                          Message.success(checked ? '已启用' : '已禁用');
                          loadEnvVars();
                        } catch (error: any) {
                          Message.error(error.response?.data?.error || '操作失败');
                        }
                      }}
                    />
                  </div>
                  <Space wrap>
                    <Button type="outline" size="small" icon={<IconEdit />} onClick={() => handleEdit(item)}>
                      编辑
                    </Button>
                    <Popconfirm title="确定删除这个变量吗？" onOk={() => handleDelete(item.id)}>
                      <Button type="outline" size="small" status="danger" icon={<IconDelete />}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Table
          className="env-table"
          columns={globalColumns}
          data={envVars}
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1200 }}
          rowKey="id"
        />
      )}

      <Modal
        title={editingEnv ? '编辑变量' : '新建变量'}
        visible={visible}
        onOk={handleSubmit}
        onCancel={() => setVisible(false)}
        autoFocus={false}
        style={{ width: '90%', maxWidth: 600 }}
      >
        <Form form={form} layout="vertical">
          <FormItem label="变量名" field="key" rules={[{ required: true, message: '请输入变量名' }]}>
            <Input placeholder="例如: API_KEY" />
          </FormItem>
          <FormItem label="变量值" field="value" rules={[{ required: true, message: '请输入变量值' }]}>
            <Input.TextArea placeholder="变量值" rows={3} />
          </FormItem>
          <FormItem label="描述" field="remark">
            <Input placeholder="变量描述" />
          </FormItem>
          <FormItem label="标签" field="tag">
            <Input placeholder="例如：bitboo / global / memory-monitor" />
          </FormItem>
        </Form>
      </Modal>

    </Card>
    </>
  );
};

export default Env;
