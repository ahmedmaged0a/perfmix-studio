type CardProps = {
  title: string
  body: string
}

export function Card({ title, body }: CardProps) {
  return (
    <article className="card">
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  )
}
