import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudAccount } from '@/types/cloudAccount';
import { useUpdateSelectedModels } from '@/hooks/useCloudAccounts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, CheckCircle2, Box } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

interface ModelSelectorProps {
  account: CloudAccount;
  onClose: () => void;
}

export function ModelSelector({ account, onClose }: ModelSelectorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const updateMutation = useUpdateSelectedModels();
  
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    new Set(account.selected_models || [])
  );

  const availableModels = Object.entries(account.quota?.models || {});
  
  const filteredModels = availableModels.filter(([id, info]: [string, any]) => 
    id.toLowerCase().includes(search.toLowerCase()) || 
    info.displayName?.toLowerCase().includes(search.toLowerCase())
  );

  const toggleModel = (model: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  const handleSave = () => {
    updateMutation.mutate({ 
      accountId: account.id, 
      models: Array.from(selected) 
    }, {
      onSuccess: () => {
        toast({ title: t('cloud.selector.success', 'Modelos selecionados com sucesso!') });
        onClose();
      },
      onError: () => {
        toast({ 
          title: t('cloud.selector.error', 'Erro ao salvar seleção'), 
          variant: 'destructive' 
        });
      }
    });
  };

  return (
    <div className="space-y-4 py-2">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('cloud.selector.search', 'Buscar modelos...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      <ScrollArea className="h-[300px] rounded-md border p-4 bg-muted/5">
        {availableModels.length > 0 ? (
          <div className="space-y-3">
            {filteredModels.map(([id, info]: [string, any]) => (
              <div key={id} className="flex items-center space-x-3 group">
                <Checkbox
                  id={`model-${id}`}
                  checked={selected.has(id)}
                  onCheckedChange={() => toggleModel(id)}
                />
                <Label
                  htmlFor={`model-${id}`}
                  className="flex-1 cursor-pointer flex flex-col group-hover:text-primary transition-colors truncate"
                >
                  <span className="text-sm font-semibold leading-none">{info.displayName || id}</span>
                  <span className="text-[10px] opacity-50 mt-1 uppercase">
                    {id} {info.maxTokenAllowed ? `• ${info.maxTokenAllowed >= 1000000 ? (info.maxTokenAllowed / 1000000) + 'M' : (info.maxTokenAllowed / 1000) + 'k'} ctx` : ''}
                  </span>
                </Label>
              </div>
            ))}
            {filteredModels.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground opacity-50">
                <Search className="h-10 w-10 mb-2" />
                <p className="text-xs">{t('cloud.selector.noResults', 'Nenhum modelo compatível.')}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
            <Box className="h-12 w-12 mb-2" />
            <p className="text-sm">{t('cloud.selector.empty', 'Nenhum dado de quota disponível.')}</p>
          </div>
        )}
      </ScrollArea>

      <div className="flex justify-between items-center pt-2 border-t">
        <div className="text-[10px] font-black uppercase opacity-40">
           {selected.size} {t('cloud.selector.count', 'Selecionados')}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', 'Cancelar')}
          </Button>
          <Button 
            size="sm" 
            onClick={handleSave} 
            disabled={updateMutation.isPending}
            className="font-bold uppercase tracking-tighter"
          >
            {updateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            {t('common.save', 'Salvar')}
          </Button>
        </div>
      </div>
    </div>
  );
}
