/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./frontend/index.html",         // 프론트엔드 루트의 index.html
    "./frontend/pages/**/*.html",    // pages 폴더 내의 모든 html
    "./frontend/js/**/*.js",         // js 폴더 내의 모든 js
  ],
  theme: {
    extend: {
      // 1. 키프레임(동작) 정의
      keyframes: {
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      },
      // 2. 애니메이션(속도 및 방식) 연결
      animation: {
        slideUp: 'slideUp 0.3s ease-out forwards',
      }
    },
  },
  plugins: [],
}