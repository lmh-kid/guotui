'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Copy, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import ComboSelect from '@/components/combo-select';
import { apiRequest } from '@/lib/api-request';

interface MaterialOption {
  id: number;
  materialCode: string;
  colors: Array<{ id: number; colorCode: string }>;
}

interface EditableItem {
  id: string;
  oid: string;
  sysOid: string;
  num: number;
  title: string;
  spec: string | null;
  image: string | null;
  currentSku: string | null;
  materialCode: string | null;
  colorCode: string | null;
  modelCode: string | null;
  pictureCode: string | null;
}

interface MerchantCodeResponse {
  order: {
    tid: string;
    sysTid: string;
    storeName: string;
    factoryId: number | null;
    dfStatus: number;
  };
  items: EditableItem[];
  options: {
    materials: MaterialOption[];
    models: string[];
    pics: string[];
    /** 材质 → 可选型号（商品库聚合，型号与材质联动） */
    modelsByMaterial?: Record<string, string[]>;
  };
  /** false = 型号/图号选项尚在后台聚合（首次访问），前端可轮询刷新 */
  optionsReady?: boolean;
}

/** 编辑态：每个商品的四要素 */
interface DraftItem {
  id: string;
  materialCode: string;
  colorCode: string;
  modelCode: string;
  pictureCode: string;
}

const DF_STATUS_TEXT: Record<number, string> = {
  0: '待整理',
  1: '待推送',
  2: '已反审',
};

const combinedCode = (d: DraftItem): string =>
  [d.materialCode, d.colorCode, d.modelCode, d.pictureCode].map((s) => s.trim()).join('-');

interface MerchantCodeDialogProps {
  /** 方果平台订单号 tid */
  orderNo: string;
  onClose: () => void;
  /** 保存成功后回调（父页面刷新列表） */
  onSuccess: () => void;
}

export default function MerchantCodeDialog({ orderNo, onClose, onSuccess }: MerchantCodeDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<MerchantCodeResponse['order'] | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [options, setOptions] = useState<MerchantCodeResponse['options']>({
    materials: [],
    models: [],
    pics: [],
  });
  const [optionsReady, setOptionsReady] = useState(true);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);

  const applyResponse = (data: MerchantCodeResponse) => {
    setOrder(data.order);
    setItems(data.items);
    setOptions(data.options);
    setOptionsReady(data.optionsReady !== false);
    setDrafts((prev) =>
      prev.length === 0
        ? data.items.map((it) => ({
            id: it.id,
            materialCode: it.materialCode ?? '',
            colorCode: it.colorCode ?? '',
            modelCode: it.modelCode ?? '',
            pictureCode: it.pictureCode ?? '',
          }))
        : prev
    );
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiRequest<MerchantCodeResponse>(
          `/api/orders/${encodeURIComponent(orderNo)}/merchant-code`
        );
        if (cancelled) return;
        applyResponse(data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '加载订单编码信息失败';
        toast.error(message);
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNo]);

  // 型号/图号选项后台聚合中（首次访问）：每 3 秒轮询（最多 20 次），就绪后自动补全候选
  useEffect(() => {
    if (optionsReady || loading) return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      if (attempts > 20) {
        setOptionsReady(true); // 超过 1 分钟视为该工厂暂无历史型号数据，停止轮询
        clearInterval(timer);
        return;
      }
      try {
        const data = await apiRequest<MerchantCodeResponse>(
          `/api/orders/${encodeURIComponent(orderNo)}/merchant-code`
        );
        if (data.optionsReady !== false) {
          setOptions(data.options);
          setOptionsReady(true);
          clearInterval(timer);
        }
      } catch {
        // 静默重试
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [optionsReady, loading, orderNo]);

  /** 材质选项（含商品现有材质兜底，避免已解码值不在工厂当前列表时丢失显示） */
  const materialOptions = useMemo(() => {
    const list = [...options.materials];
    const known = new Set(list.map((m) => m.materialCode));
    for (const it of items) {
      if (it.materialCode && !known.has(it.materialCode)) {
        list.push({
          id: -1,
          materialCode: it.materialCode,
          colors: it.colorCode ? [{ id: -1, colorCode: it.colorCode }] : [],
        });
        known.add(it.materialCode);
      }
    }
    return list;
  }, [options.materials, items]);

  const colorsOf = useCallback(
    (materialCode: string, fallbackColor: string | null): Array<{ id: number; colorCode: string }> => {
      const m = materialOptions.find((x) => x.materialCode === materialCode);
      const colors = m?.colors ?? [];
      if (fallbackColor && !colors.some((c) => c.colorCode === fallbackColor)) {
        return [...colors, { id: -1, colorCode: fallbackColor }];
      }
      return colors;
    },
    [materialOptions]
  );

  /** 型号选项与材质联动：优先取该材质下出现过的型号，无数据时回退全量；当前已选值始终保留在候选中 */
  const modelOptionsFor = useCallback(
    (materialCode: string, currentModel: string | null): string[] => {
      const scoped = materialCode ? options.modelsByMaterial?.[materialCode] : undefined;
      const base = scoped && scoped.length > 0 ? scoped : options.models;
      if (currentModel && !base.includes(currentModel)) return [currentModel, ...base];
      return base;
    },
    [options.modelsByMaterial, options.models]
  );

  const updateDraft = (id: string, patch: Partial<DraftItem>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const handleMaterialChange = (id: string, materialCode: string) => {
    const colors = colorsOf(materialCode, null);
    // 材质切换后颜色联动：优先保留同色，否则取第一个
    // 型号联动：该材质在商品库有型号数据且当前型号不在其中时清空，需重新选择
    const draft = drafts.find((d) => d.id === id);
    const currentModel = draft?.modelCode ?? '';
    const scoped = options.modelsByMaterial?.[materialCode];
    const keepModel =
      !scoped || scoped.length === 0 || !currentModel || scoped.includes(currentModel);
    updateDraft(id, {
      materialCode,
      colorCode: colors.length > 0 ? colors[0].colorCode : '',
      modelCode: keepModel ? currentModel : '',
    });
  };

  /** 将某行四要素复制到全部商品（同款多数量场景） */
  const applyToAll = (sourceId: string) => {
    const source = drafts.find((d) => d.id === sourceId);
    if (!source) return;
    setDrafts((prev) =>
      prev.map((d) => ({
        ...d,
        materialCode: source.materialCode,
        colorCode: source.colorCode,
        modelCode: source.modelCode,
        pictureCode: source.pictureCode,
      }))
    );
    toast.success('已应用到全部商品');
  };

  const incomplete = drafts.filter(
    (d) => !d.materialCode.trim() || !d.colorCode.trim() || !d.modelCode.trim() || !d.pictureCode.trim()
  );

  const handleSave = async () => {
    if (incomplete.length > 0) {
      toast.warning(`还有 ${incomplete.length} 个商品未填完「材质/颜色/型号/图号」`);
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ success: boolean; message: string }>(
        `/api/orders/${encodeURIComponent(orderNo)}/merchant-code`,
        {
          method: 'POST',
          body: JSON.stringify({ items: drafts }),
        }
      );
      toast.success(result.message || '商家编码已保存');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '保存失败';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-[960px] sm:max-w-[960px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            修改商家编码
            {order && (
              <>
                <span className="text-xs text-gray-400 font-mono font-normal">{order.tid}</span>
                <Badge className="bg-gray-100 text-gray-700 text-xs">
                  {DF_STATUS_TEXT[order.dfStatus] ?? `dfStatus ${order.dfStatus}`}
                </Badge>
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            编码规则：材质-颜色-型号-图号（如：90克磨毛布被套三件套-混合色-220X230-28810029）
            {order?.factoryId ? ` · 当前工厂 #${order.factoryId}` : ' · 工厂待定'}
          </DialogDescription>
        </DialogHeader>

        {!loading && !optionsReady && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 flex items-center gap-2 text-sm text-blue-700">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            型号/图号候选正在后台加载，可直接手动输入，就绪后自动补全候选。
          </div>
        )}

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item, idx) => {
              const draft = drafts[idx] ?? { id: item.id, materialCode: '', colorCode: '', modelCode: '', pictureCode: '' };
              const colors = colorsOf(draft.materialCode, item.colorCode);
              return (
                <div key={item.id} className="rounded-lg border border-gray-200 p-4">
                  {/* 商品信息 */}
                  <div className="flex gap-3 mb-3">
                    {item.image && (
                      <img src={item.image} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 max-w-[720px] break-words" title={item.title}>
                        {item.title}
                      </p>
                      <div className="flex gap-2 items-center mt-0.5 flex-wrap">
                        {item.spec && <span className="text-xs text-gray-500 truncate max-w-xs">{item.spec}</span>}
                        <span className="text-xs text-gray-400">x{item.num}</span>
                      </div>
                      {item.currentSku && item.currentSku !== '*-*-*-*' && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          当前编码：<span className="font-mono text-gray-600">{item.currentSku}</span>
                        </p>
                      )}
                    </div>
                    {items.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-500 h-7 px-2 flex-shrink-0"
                        onClick={() => applyToAll(item.id)}
                        title="将此行的四要素复制到全部商品"
                      >
                        <Copy className="w-3.5 h-3.5 mr-1" />
                        应用到全部
                      </Button>
                    )}
                  </div>

                  {/* 四要素编辑（可搜索下拉）+ 图片展示区 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_120px] gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">
                        材质 <span className="text-red-500">*</span>
                      </label>
                      <ComboSelect
                        options={materialOptions.map((m) => m.materialCode)}
                        value={draft.materialCode}
                        onValueChange={(v) => handleMaterialChange(item.id, v)}
                        placeholder="选择材质"
                        searchPlaceholder="输入材质关键字..."
                        allowClear
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">
                        颜色 <span className="text-red-500">*</span>
                      </label>
                      <ComboSelect
                        options={colors.map((c) => c.colorCode)}
                        value={draft.colorCode}
                        onValueChange={(v) => updateDraft(item.id, { colorCode: v })}
                        placeholder={draft.materialCode ? '选择颜色' : '先选材质'}
                        searchPlaceholder="输入颜色关键字..."
                        allowClear
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">
                        型号 <span className="text-red-500">*</span>
                      </label>
                      <ComboSelect
                        options={modelOptionsFor(draft.materialCode, item.modelCode)}
                        value={draft.modelCode}
                        onValueChange={(v) => updateDraft(item.id, { modelCode: v })}
                        placeholder={optionsReady ? (draft.materialCode ? '选择型号' : '先选材质可缩小型号范围') : '候选加载中...'}
                        searchPlaceholder="输入型号关键字..."
                        allowClear
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">
                        图号 <span className="text-red-500">*</span>
                      </label>
                      <ComboSelect
                        options={options.pics}
                        value={draft.pictureCode}
                        onValueChange={(v) => updateDraft(item.id, { pictureCode: v })}
                        placeholder={optionsReady ? '选择图号' : '候选加载中...'}
                        searchPlaceholder="输入图号关键字..."
                        allowClear
                      />
                    </div>

                    {/* 图片展示区域 */}
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">图片</label>
                      <div className="w-full h-[76px] rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.title}
                            title="点击查看大图"
                            className="w-full h-full object-contain cursor-zoom-in hover:opacity-80 transition-opacity"
                            onClick={() => window.open(item.image ?? '', '_blank')}
                          />
                        ) : (
                          <span className="text-xs text-gray-400">暂无图片</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 组合预览 */}
                  <div className="mt-3 text-xs text-gray-500">
                    新编码：
                    <span className={`font-mono ml-1 ${incomplete.some((d) => d.id === item.id) ? 'text-gray-400' : 'text-blue-600'}`}>
                      {combinedCode(draft) || '-'}
                    </span>
                  </div>
                </div>
              );
            })}

            {incomplete.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2 text-sm text-amber-700">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>有 {incomplete.length} 个商品的「材质/颜色/型号/图号」未填完整，保存前需全部填写。</div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={loading || saving || incomplete.length > 0}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
