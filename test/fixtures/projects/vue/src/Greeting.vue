<template>
  <div>
    <h1>Welcome to our store</h1>
    <button title="Add to cart">+</button>
    <input placeholder="search" />
    <span>{{ count }}</span>
    <p class="price-tag">$9.99</p>
  </div>
</template>

<script>
export default {
  data() {
    return {
      count: 0,
      label: 'Click me to continue',
    }
  },
  methods: {
    onClick() {
      console.log('debug click handler fired')
    },
  },
}
</script>
