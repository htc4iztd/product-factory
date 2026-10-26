/** @type {import('next').NextConfig} */
// 資料の取り込み（20MB まで）を middleware で切り詰めないように、受け付ける本文の上限を上げる
const nextConfig = { output: "standalone", experimental: { proxyClientMaxBodySize: 25 * 1024 * 1024 } };
export default nextConfig;
