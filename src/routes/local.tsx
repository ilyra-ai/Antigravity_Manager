import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAppConfig } from '@/hooks/useAppConfig';
import { useSyncLocalModels } from '@/hooks/useCloudAccounts';
import { useState, useEffect } from 'react';
import * as Lucide from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { ipc } from '@/ipc/manager';

/**
 * PhD Level Icon Proxy
 * Previne quebra de renderização se o módulo de ícones estiver instável.
 */
const Icon = ({ name, className }: { name: string; className?: string }) => {
  const LucideIcons = Lucide as any;
  const Component = LucideIcons[name] || LucideIcons['AlertCircle'];
  return <Component className={className} />;
};

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'failed';

function LocalAIPage() {
  const { t } = useTranslation();
  const { config, isLoading, saveConfig, isSaving } = useAppConfig();
  const syncModelsMutation = useSyncLocalModels();
  const { toast } = useToast();

  const [ollamaUrl, setOllamaUrl] = useState('');
  const [lmstudioUrl, setLmstudioUrl] = useState('');
  const [ollamaStatus, setOllamaStatus] = useState<ConnectionStatus>('idle');
  const [lmstudioStatus, setLmstudioStatus] = useState<ConnectionStatus>('idle');

  useEffect(() => {
    if (config?.local_ai) {
      setOllamaUrl(config.local_ai.ollama.url);
      setLmstudioUrl(config.local_ai.lmstudio.url);
    }
  }, [config]);

  /**
   * PhD Level: Industrial URL Normalization
   * Uses the native URL engine to resolve and clean any malformed user input.
   */
  const normalizeForStorage = (input: string) => {
      if (!input) return '';
      try {
          const url = new URL(input.trim());
          // Extract protocol and host (including port)
          const base = `${url.protocol}//${url.host}`;
          return `${base}/v1`;
      } catch (e) {
          // Fallback if URL is not absolute, try to fix manually
          let clean = input.trim().replace(/\/+$/, '');
          clean = clean.replace(/\/+v1$/, '').replace(/\/+models$/, '');
          clean = clean.replace(/([^:])\/+/g, '$1/');
          return `${clean}/v1`;
      }
  };

  const handleSaveEndpoints = async () => {
    if (!config) return;
    try {
      const finalOllama = normalizeForStorage(ollamaUrl);
      const finalLmstudio = normalizeForStorage(lmstudioUrl);
      
      await saveConfig({
        ...config,
        local_ai: {
          ollama: { ...config.local_ai.ollama, url: finalOllama },
          lmstudio: { ...config.local_ai.lmstudio, url: finalLmstudio }
        }
      });
      toast({ title: 'Configuração Sincronizada', description: 'O banco de dados soberano foi atualizado.' });
    } catch (e) {
      toast({ title: 'Erro de Persistência', description: 'Não foi possível gravar no disco.', variant: 'destructive' });
    }
  };

  const handleSync = async () => {
    // First, persist to ensure the backend uses the latest user input
    await handleSaveEndpoints();
    
    syncModelsMutation.mutate(undefined, {
      onSuccess: (count) => {
        toast({ 
          title: 'Varredura Concluída', 
          description: count > 0 ? `${count} modelos detectados e registrados.` : 'Nenhum modelo novo encontrado no hardware.' 
        });
      },
      onError: (err: any) => {
        toast({ 
          title: 'Erro de Handshake', 
          description: `Falha ao alcançar o hardware local: ${err.message}`,
          variant: 'destructive' 
        });
      }
    });
  };

  const testConnection = async (provider: 'ollama' | 'lmstudio') => {
    const setStatus = provider === 'ollama' ? setOllamaStatus : setLmstudioStatus;
    setStatus('testing');
    
    try {
        // Trigger save first to make sure the endpoint is in the DB
        await handleSaveEndpoints();
        const result = await ipc.client.cloud.syncLocalModels();
        if (result >= 0) {
            setStatus('success');
            toast({ title: 'Link Ativo', description: `Conexão com ${provider.toUpperCase()} estabelecida.` });
        } else {
            setStatus('failed');
        }
    } catch (e) {
        setStatus('failed');
        toast({ title: 'Time-out ou Erro', description: 'Verifique se o servidor local está rodando.', variant: 'destructive' });
    }
  };

  if (isLoading || !config) return <div className="flex h-screen items-center justify-center"><Icon name="Loader2" className="animate-spin text-primary h-8 w-8" /></div>;

  return (
    <div className="container mx-auto h-[calc(100vh-theme(spacing.16))] max-w-4xl space-y-6 overflow-y-auto p-6 scrollbar-hide">
      <div className="flex items-center justify-between border-b pb-6">
        <div>
          <h2 className="text-3xl font-black tracking-tighter">IA LOCAL <span className="text-primary">SOVEREIGN</span></h2>
          <p className="text-muted-foreground text-xs font-bold uppercase tracking-[0.2em]">Ponte de Inteligência Privada</p>
        </div>
        <Button onClick={handleSync} disabled={syncModelsMutation.isPending} className="gap-2 bg-primary dark:text-black font-black uppercase text-xs tracking-widest shadow-xl">
          {syncModelsMutation.isPending ? <Icon name="RefreshCw" className="h-4 w-4 animate-spin" /> : <Icon name="Activity" className="h-4 w-4" />}
          Sincronizar Hardware
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Ollama */}
        <Card className="border-2 border-orange-500/10 bg-orange-500/[0.02] hover:border-orange-500/30 transition-all">
          <CardHeader>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-orange-500/20 p-2 rounded-lg text-orange-600 shadow-sm"><Icon name="Cpu" className="h-6 w-6" /></div>
                    <CardTitle className="font-black text-orange-500">OLLAMA</CardTitle>
                </div>
                <Switch 
                    checked={config.local_ai.ollama.enabled} 
                    onCheckedChange={() => saveConfig({...config, local_ai: {...config.local_ai, ollama: {...config.local_ai.ollama, enabled: !config.local_ai.ollama.enabled}}})} 
                />
            </div>
            <CardDescription className="text-[10px] font-bold uppercase opacity-60">Engine Nativa - Local Meta / Llama</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[9px] font-black uppercase opacity-40">Endereço da API</Label>
              <div className="flex gap-2">
                <Input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} className="font-mono text-xs bg-orange-500/5 border-orange-500/10 focus:border-orange-500" placeholder="ex: http://127.0.0.1:11434" />
                <Button variant="outline" size="sm" onClick={() => testConnection('ollama')} className="border-orange-500/20">
                  {ollamaStatus === 'testing' ? <Icon name="Loader2" className="h-3 w-3 animate-spin" /> : ollamaStatus === 'success' ? <Icon name="CheckCircle2" className="h-4 w-4 text-green-500" /> : <Icon name="Zap" className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* LM Studio */}
        <Card className="border-2 border-purple-500/10 bg-purple-500/[0.02] hover:border-purple-500/30 transition-all">
          <CardHeader>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-purple-500/20 p-2 rounded-lg text-purple-600 shadow-sm"><Icon name="HardDrive" className="h-6 w-6" /></div>
                    <CardTitle className="font-black text-purple-500">LM STUDIO</CardTitle>
                </div>
                <Switch 
                    checked={config.local_ai.lmstudio.enabled} 
                    onCheckedChange={() => saveConfig({...config, local_ai: {...config.local_ai, lmstudio: {...config.local_ai.lmstudio, enabled: !config.local_ai.lmstudio.enabled}}})} 
                />
            </div>
            <CardDescription className="text-[10px] font-bold uppercase opacity-60">Barramento OpenAI Compatível</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[9px] font-black uppercase opacity-40">Endereço de Produção</Label>
              <div className="flex gap-2">
                <Input value={lmstudioUrl} onChange={(e) => setLmstudioUrl(e.target.value)} className="font-mono text-xs bg-purple-500/5 border-purple-500/10 focus:border-purple-500" placeholder="ex: http://192.168.0.7:1234" />
                <Button variant="outline" size="sm" onClick={() => testConnection('lmstudio')} className="border-purple-500/20">
                  {lmstudioStatus === 'testing' ? <Icon name="Loader2" className="h-3 w-3 animate-spin" /> : lmstudioStatus === 'success' ? <Icon name="CheckCircle2" className="h-4 w-4 text-green-500" /> : <Icon name="Zap" className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end gap-3 pt-6 border-t border-dashed">
         <Button variant="ghost" onClick={() => { setOllamaUrl(config.local_ai.ollama.url); setLmstudioUrl(config.local_ai.lmstudio.url); }} className="text-xs font-black uppercase opacity-50 hover:opacity-100">Descartar</Button>
         <Button onClick={handleSaveEndpoints} disabled={isSaving} className="px-10 gap-2 font-black uppercase text-xs bg-muted">
            {isSaving ? <Icon name="Loader2" className="h-4 w-4 animate-spin" /> : <Icon name="Download" className="h-4 w-4" />}
            Salvar Endpoints Reais
         </Button>
      </div>

      <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-8 flex items-start gap-5">
          <Icon name="AlertTriangle" className="h-8 w-8 text-yellow-600 opacity-80" />
          <div className="space-y-2">
              <h4 className="text-sm font-black uppercase tracking-tighter">Diretriz Técnica PhD</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                  O Antigravity Manager atua como um <strong>Gatekeeper</strong>. <br/>
                  1. O sistema sanitiza automaticamente URLs complexas para garantir o padrão "/v1". <br/>
                  2. Certifique-se de que o hardware alvo não possui firewalls bloqueando a porta. <br/>
                  3. A varredura de modelos popula a lista de contas como entidades soberanas de hardware.
              </p>
          </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/local')({
  component: LocalAIPage,
});
