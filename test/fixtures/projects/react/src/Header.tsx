import React from 'react'

export function Header() {
  console.log('render header debug')
  return (
    <div className="header">
      <h1>Welcome back, friend</h1>
      <button aria-label="close dialog">x</button>
      <span>{count}</span>
      <p>{total}</p>
      <code>ok</code>
    </div>
  )
}
