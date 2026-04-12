import type { ReactNode } from 'react'

type PageProps = {
  title: string
  subtitle: string
  children: ReactNode
}

export function Page({ title, subtitle, children }: PageProps) {
  return (
    <section className="page">
      <header className="page-head">
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>
      </header>
      {children}
    </section>
  )
}
