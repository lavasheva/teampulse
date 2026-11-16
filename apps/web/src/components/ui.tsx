import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import type { ComponentProps, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'

function cn(...values: ClassValue[]) {
  return twMerge(clsx(values))
}

const buttonVariants = cva('button', {
  variants: {
    variant: { primary: 'button-primary', outline: 'button-outline', dark: 'button-dark', ghost: 'button-ghost' },
  },
  defaultVariants: { variant: 'primary' },
})

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }

export function Button({ className, variant, asChild, type = 'button', ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button'
  return <Component className={cn(buttonVariants({ variant }), className)} {...(!asChild && { type })} {...props} />
}

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('card', className)} {...props} />
}

export function Panel({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return <Card className={className}><div className="panel-heading"><h2>{title}</h2>{aside}</div>{children}</Card>
}

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return <span className={cn('brand', inverse && 'brand-inverse')}><span aria-hidden="true">T</span>TeamPulse</span>
}

export function Avatar({ name, color = '#6256e5' }: { name: string; color?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  return <span className="avatar" style={{ backgroundColor: color }} aria-hidden="true">{initials}</span>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function PageHeader({ title, description, eyebrow, actions }: { title: ReactNode; description?: string; eyebrow?: ReactNode; actions?: ReactNode }) {
  return <header className="page-heading">
    <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="actions">{actions}</div>}
  </header>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <Card className="empty-state"><h2>{title}</h2>{children}</Card>
}

export function Meter({ value, label, color }: { value: number; label: string; color?: string }) {
  const percent = Math.max(0, Math.min(value, 100))
  return <span className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%`, backgroundColor: color }} /></span>
}
