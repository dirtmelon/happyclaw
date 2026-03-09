import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Copy, Check, Link, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import type { SettingsNotification } from './types';
import { getErrorMessage } from './types';

interface UserQQConfig {
  appId: string;
  hasAppSecret: boolean;
  appSecretMasked: string | null;
  enabled: boolean;
}

interface PairingCodeResult {
  code: string;
  expiresAt: number;
  ttlSeconds: number;
}

interface PairedChat {
  jid: string;
  name: string;
  addedAt: string;
}

/** Clipboard write with fallback for non-HTTPS contexts */
function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch {
      reject(new Error('execCommand copy failed'));
    } finally {
      document.body.removeChild(ta);
    }
  });
}

interface QQSectionProps extends SettingsNotification {}

export function QQSection({ setNotice, setError }: QQSectionProps) {
  const [config, setConfig] = useState<UserQQConfig | null>(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Pairing state
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingCountdown, setPairingCountdown] = useState(0);
  const [pairingGenerating, setPairingGenerating] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Paired chats state
  const [pairedChats, setPairedChats] = useState<PairedChat[]>([]);
  const [pairedChatsLoading, setPairedChatsLoading] = useState(false);
  const [removingJid, setRemovingJid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<UserQQConfig>('/api/config/user-im/qq');
      setConfig(data);
      setAppId(data.appId || '');
      setAppSecret('');
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPairedChats = useCallback(async () => {
    setPairedChatsLoading(true);
    try {
      const data = await api.get<{ chats: PairedChat[] }>('/api/config/user-im/qq/paired-chats');
      setPairedChats(data.chats);
    } catch {
      setPairedChats([]);
    } finally {
      setPairedChatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadPairedChats();
  }, [loadConfig, loadPairedChats]);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const startCountdown = useCallback((expiresAt: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const update = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setPairingCountdown(remaining);
      if (remaining <= 0) {
        setPairingCode(null);
        if (countdownRef.current) clearInterval(countdownRef.current);
      }
    };
    update();
    countdownRef.current = setInterval(update, 1000);
  }, []);

  const handleGeneratePairingCode = async () => {
    setPairingGenerating(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.post<PairingCodeResult>('/api/config/user-im/qq/pairing-code');
      setPairingCode(result.code);
      startCountdown(Date.now() + result.ttlSeconds * 1000);
    } catch (err) {
      setError(getErrorMessage(err, '生成配对码失败'));
    } finally {
      setPairingGenerating(false);
    }
  };

  const handleCopyPairCommand = () => {
    if (!pairingCode) return;
    copyToClipboard(`/pair ${pairingCode}`).then(() => {
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setError('复制失败，请手动复制');
    });
  };

  const handleRemovePairedChat = async (jid: string) => {
    setRemovingJid(jid);
    setNotice(null);
    setError(null);
    try {
      await api.delete(`/api/config/user-im/qq/paired-chats/${encodeURIComponent(jid)}`);
      setPairedChats((prev) => prev.filter((c) => c.jid !== jid));
      setNotice('已移除配对聊天');
    } catch (err) {
      setError(getErrorMessage(err, '移除配对聊天失败'));
    } finally {
      setRemovingJid(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const id = appId.trim();
      const secret = appSecret.trim();

      if (id && !secret && !config?.hasAppSecret) {
        setError('首次配置 QQ 需要同时提供 App ID 和 App Secret');
        setSaving(false);
        return;
      }

      if (!id && !secret) {
        if (config?.appId || config?.hasAppSecret) {
          setNotice('QQ 配置未变更');
        } else {
          setError('请填写 QQ Bot App ID 和 App Secret');
        }
        setSaving(false);
        return;
      }

      const payload: Record<string, string | boolean> = { enabled: true };
      if (id) payload.appId = id;
      if (secret) payload.appSecret = secret;
      await api.put('/api/config/user-im/qq', payload);
      setNotice('QQ 配置已保存');
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, '保存 QQ 配置失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('/api/config/user-im/qq/test');
      setNotice('QQ 连接测试成功');
    } catch (err) {
      setError(getErrorMessage(err, 'QQ 连接测试失败'));
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-slate-500">加载中...</div>;
  }

  return (
    <div>
      {config?.hasAppSecret && (
        <div className="text-xs text-slate-500 mb-2">
          当前 Secret: {config.appSecretMasked || '已配置'}
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">App ID</label>
          <Input
            type="text"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="输入 QQ Bot App ID"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">App Secret</label>
          <Input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder={config?.hasAppSecret ? '留空不修改' : '输入 QQ Bot App Secret'}
          />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          保存 QQ 配置
        </Button>
        {config?.hasAppSecret && (
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing && <Loader2 className="size-4 animate-spin" />}
            测试连接
          </Button>
        )}
      </div>

      {/* Chat Pairing */}
      {config?.hasAppSecret && (
        <div className="border-t border-slate-100 mt-4 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Link className="w-4 h-4 text-slate-500" />
            <h4 className="text-sm font-medium text-slate-700">聊天配对</h4>
          </div>

          {pairingCode && pairingCountdown > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <code className="text-2xl font-mono font-bold tracking-widest text-primary bg-primary/5 px-4 py-2 rounded-lg select-all">
                  {pairingCode}
                </code>
                <div className="text-sm text-slate-500">
                  {Math.floor(pairingCountdown / 60)}:{String(pairingCountdown % 60).padStart(2, '0')} 后过期
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" className="cursor-pointer" onClick={handleCopyPairCommand}>
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '已复制' : '复制配对命令'}
                </Button>
                <Button variant="outline" size="sm" onClick={handleGeneratePairingCode} disabled={pairingGenerating}>
                  {pairingGenerating && <Loader2 className="size-3.5 animate-spin" />}
                  重新生成
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                在 QQ 中向 Bot 发送 <code className="bg-slate-100 px-1 rounded">/pair {pairingCode}</code> 完成配对
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Button variant="outline" onClick={handleGeneratePairingCode} disabled={pairingGenerating}>
                {pairingGenerating && <Loader2 className="size-4 animate-spin" />}
                生成配对码
              </Button>
              <p className="text-xs text-slate-400">
                生成一次性配对码，在 QQ 聊天中发送 <code className="bg-slate-100 px-1 rounded">/pair &lt;code&gt;</code> 将聊天绑定到此账号
              </p>
            </div>
          )}

          {/* Paired chats list */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-xs font-medium text-slate-600">已配对的聊天</h5>
              <button
                onClick={loadPairedChats}
                disabled={pairedChatsLoading}
                className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50"
              >
                刷新
              </button>
            </div>
            {pairedChatsLoading ? (
              <div className="text-xs text-slate-400">加载中...</div>
            ) : pairedChats.length === 0 ? (
              <div className="text-xs text-slate-400">暂无已配对的聊天</div>
            ) : (
              <div className="space-y-1.5">
                {pairedChats.map((chat) => (
                  <div key={chat.jid} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 group">
                    <div className="min-w-0">
                      <div className="text-sm text-slate-700 truncate">{chat.name}</div>
                      <div className="text-xs text-slate-400">{new Date(chat.addedAt).toLocaleString('zh-CN')}</div>
                    </div>
                    <button
                      onClick={() => handleRemovePairedChat(chat.jid)}
                      disabled={removingJid === chat.jid}
                      className="ml-2 p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                      title="移除配对"
                    >
                      {removingJid === chat.jid ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <X className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
