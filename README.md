# VPA Automation — Website

Website giới thiệu công ty VPA Automation: chế tạo máy tự động hóa và dịch vụ kỹ thuật cho doanh nghiệp sản xuất.

Một file tĩnh duy nhất (`index.html`), không cần build, deploy được ngay lên **Cloudflare Pages** hoặc **GitHub Pages**.

## Cấu trúc
- `index.html` — toàn bộ trang web (HTML + CSS + JS trong một file)

## Trước khi chạy thật, cần làm
1. **Kích hoạt form liên hệ:** lấy access key miễn phí tại https://web3forms.com (dùng email `sales@vpaauto.com`), thay vào chỗ `YOUR_ACCESS_KEY_HERE` trong `index.html`.
2. Điền số điện thoại, mã số thuế và cập nhật số liệu phần "Năng lực" cho đúng thực tế.

## Deploy

### Cách 1 — Cloudflare Pages (qua GitHub, tự động deploy mỗi lần push)
1. Đưa repo này lên GitHub (xem phần dưới).
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → chọn repo.
3. Build command: để trống hoặc `exit 0`. Output directory: `/` (thư mục gốc).
4. Deploy. Gắn tên miền `vpaauto.com` ở mục Custom domains.

### Cách 2 — GitHub Pages
1. Repo → Settings → Pages → Source: `Deploy from a branch` → branch `main`, folder `/ (root)` → Save.
2. Vài phút sau web chạy ở `https://<tài-khoản>.github.io/vpa-automation/`.

## Đưa lên GitHub
Tạo repo trống tên `vpa-automation` trên github.com (KHÔNG tích "Add README"), rồi chạy:

```bash
git remote add origin https://github.com/<TÊN-TÀI-KHOẢN>/vpa-automation.git
git branch -M main
git push -u origin main
```
