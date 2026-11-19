'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboSelectProps {
  /** 选项列表（纯字符串编码，前端搜索过滤） */
  options: string[];
  /** 当前值 */
  value: string;
  /** 选中回调 */
  onValueChange: (value: string) => void;
  /** 触发器占位文案 */
  placeholder?: string;
  /** 搜索框占位文案 */
  searchPlaceholder?: string;
  /** 无匹配时的提示 */
  emptyText?: string;
  /** 允许搜索无结果时直接采用输入值（自定义编码） */
  allowFreeInput?: boolean;
  /** 允许清除已选值（显示 X 按钮） */
  allowClear?: boolean;
  /** 禁用态 */
  disabled?: boolean;
  /** 列表最大高度 class（默认 max-h-60） */
  listClassName?: string;
}

/**
 * 可搜索下拉选择（Popover + cmdk 前端过滤）。
 * 材质/颜色/型号/图号四要素编码选择用，选项较多时输入关键字过滤。
 * 注：onWheelCapture 阻止冒泡，修复弹窗（Dialog 内嵌 Popover）滚轮滚动被锁的问题。
 */
export default function ComboSelect({
  options,
  value,
  onValueChange,
  placeholder = '请选择',
  searchPlaceholder = '输入关键字过滤...',
  emptyText = '暂无匹配选项',
  allowFreeInput = true,
  allowClear = false,
  disabled = false,
  listClassName,
}: ComboSelectProps) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');

  const handleSelect = (v: string) => {
    onValueChange(v);
    setOpen(false);
    setKeyword('');
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setKeyword('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between gap-1 font-normal h-9 px-3 py-2 text-sm',
            value ? 'text-gray-900' : 'text-gray-400'
          )}
        >
          <span className="flex-1 min-w-0 truncate text-left">{value || placeholder}</span>
          <span className="flex items-center gap-0.5 shrink-0">
            {allowClear && value && !disabled && (
              <span
                role="button"
                aria-label="清除"
                tabIndex={-1}
                className="inline-flex items-center justify-center rounded p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onValueChange('');
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onWheelCapture={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <Command shouldFilter>
          <CommandInput
            value={keyword}
            onValueChange={setKeyword}
            placeholder={searchPlaceholder}
          />
          <CommandList className={cn('max-h-60', listClassName)}>
            <CommandEmpty>{allowFreeInput && keyword ? '无匹配，可选择下方自定义输入' : emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => handleSelect(opt)}
                >
                  <span className="flex-1 truncate text-left" title={opt}>
                    {opt}
                  </span>
                  <Check className={cn('h-4 w-4 shrink-0', value === opt ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              ))}
            </CommandGroup>
            {allowFreeInput && keyword && !options.includes(keyword) && (
              <CommandGroup>
                <CommandItem value={`__custom__${keyword}`} onSelect={() => handleSelect(keyword)}>
                  <span className="flex-1 truncate text-left text-blue-600">
                    使用自定义值「{keyword}」
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
