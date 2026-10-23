// CopyButton: clipboard with a fallback dialog (selectable textarea + download)
// when the Clipboard API is blocked (ТЗ п.14).
'use client'

import * as React from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export function CopyButton({
  text,
  label = 'Копировать',
  size = 'sm',
  variant = 'outline',
  className,
  disabled,
}: {
  text: string | (() => string | Promise<string>)
  label?: string
  size?: 'sm' | 'default' | 'icon'
  variant?: 'outline' | 'ghost' | 'secondary'
  className?: string
  disabled?: boolean
}) {
  const { toast } = useToast()
  const [copied, setCopied] = React.useState(false)
  const [fallbackOpen, setFallbackOpen] = React.useState(false)
  const [resolved, setResolved] = React.useState('')

  const resolveText = async () => (typeof text === 'function' ? await text() : text)

  const onCopy = async () => {
    const value = await resolveText()
    setResolved(value)
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
      toast({ title: 'Скопировано в буфер обмена' })
    } catch {
      // Clipboard API blocked — show the honest fallback
      setFallbackOpen(true)
    }
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={cn('gap-1.5', className)}
        onClick={onCopy}
        disabled={disabled || (typeof text === 'string' && text.length === 0)}
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-500" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        {size !== 'icon' && label}
      </Button>

      <Dialog open={fallbackOpen} onOpenChange={setFallbackOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Буфер обмена недоступен</DialogTitle>
            <DialogDescription>
              Браузер запретил Clipboard API. Выделите текст ниже и скопируйте вручную (Ctrl+C / ⌘C) или
              скачайте файл.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            readOnly
            value={resolved}
            className="max-h-80 min-h-[160px] font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const blob = new Blob([resolved], { type: 'text/plain;charset=utf-8' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'observatory-export.txt'
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download className="size-3.5" aria-hidden />
              Скачать файлом
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Copy any block of content with a header — used for cards/sections/reports. */
export function CopyBlock({
  title,
  text,
  className,
}: {
  title: string
  text: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2', className)}>
      <span className="truncate text-xs text-muted-foreground">{title}</span>
      <CopyButton text={text} size="sm" variant="ghost" />
    </div>
  )
}
