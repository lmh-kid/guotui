import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, ensureUserBalance } from '@/lib/auth-utils';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 生成演示数据
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  const client = getSupabaseClient(token ?? undefined);

  try {
    await ensureUserBalance(user.id, client);

    // 检查是否已有订单
    const { count, error: countError } = await client
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (countError) throw countError;

    if (count && count > 0) {
      return NextResponse.json({ error: '已有订单数据，无需重新生成' }, { status: 400 });
    }

    const statuses = ['pending', 'decoding', 'decoded', 'pushed', 'production', 'shipped'];
    const decodeStatuses = ['pending', 'success', 'fail'];
    const platforms = ['temu', 'shein', 'aliexpress'];
    const products = [
      { name: 'Miękki kocyk szalowy w stylu polaru, dwustronny w krate', spec: 'Klasyczna Monochromia / 100*150 cm', image: 'https://picsum.photos/100/100?random=1' },
      { name: 'Goaste 2 Packs Hand Woven Fan, Handheld Wheat Straw Fans', spec: 'Variant: 扇子', image: 'https://picsum.photos/100/100?random=2' },
      { name: 'Custom Phone Case for iPhone 15 Pro Max', spec: 'Black / Matte / Design A', image: 'https://picsum.photos/100/100?random=3' },
      { name: 'Personalized T-Shirt Cotton Tee', spec: 'White / L / Floral Pattern', image: 'https://picsum.photos/100/100?random=4' },
      { name: 'Custom Canvas Wall Art Poster', spec: '12x16 inch / Framed / Sunset', image: 'https://picsum.photos/100/100?random=5' },
      { name: 'Engraved Stainless Steel Water Bottle', spec: '750ml / Silver / Love Quote', image: 'https://picsum.photos/100/100?random=6' },
      { name: 'Personalized Photo Mug', spec: '11oz / White / Family Photo', image: 'https://picsum.photos/100/100?random=7' },
      { name: 'Custom Name Necklace Gold Plated', spec: 'Rose Gold / 18 inch / Emma', image: 'https://picsum.photos/100/100?random=8' },
    ];

    const names = ['Katarzyna Stawnoga', 'Emma Johnson', 'Sophie Martin', 'Anna Schmidt', 'Maria Garcia', 'Lisa Wang', 'Jennifer Lee', 'Sarah Wilson'];
    const countries = ['Poland', 'United States', 'France', 'Germany', 'Spain', 'United Kingdom', 'South Korea', 'Australia'];
    const addresses = [
      'ul. Kwiatowa 12, 00-001 Warszawa',
      '123 Main St, New York, NY 10001',
      '45 Rue de Rivoli, 75004 Paris',
      'Musterstraße 1, 10115 Berlin',
      'Calle Mayor 10, 28013 Madrid',
      '10 Downing Street, London SW1A 2AA',
      '123 Gangnam-daero, Seoul 06236',
      '1 Sydney Opera House, Sydney NSW 2000',
    ];

    const orders = [];
    const now = Date.now();

    for (let i = 0; i < 30; i++) {
      const product = products[i % products.length];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      let decodeStatus = decodeStatuses[Math.floor(Math.random() * decodeStatuses.length)];
      
      // 已推送/已发货的订单一定是解码成功的
      if (status === 'pushed' || status === 'production' || status === 'shipped') {
        decodeStatus = 'success';
      }

      const date = new Date(now - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000));

      orders.push({
        user_id: user.id,
        platform: platforms[Math.floor(Math.random() * platforms.length)],
        order_no: `PO-${Date.now()}${i}`,
        order_type: Math.random() > 0.7 ? 'Y2订单' : '正常订单',
        status,
        decode_status: decodeStatus,
        product_name: product.name,
        product_image: product.image,
        spec: product.spec,
        merchant_code: decodeStatus === 'success' ? `FG-${String(100 + i).padStart(3, '0')}` : null,
        quantity: Math.floor(Math.random() * 3) + 1,
        price: (Math.random() * 100 + 10).toFixed(2),
        receiver_name: names[Math.floor(Math.random() * names.length)],
        receiver_phone: `+${Math.floor(Math.random() * 90) + 10} ${Math.floor(Math.random() * 900000000 + 100000000)}`,
        receiver_address: addresses[Math.floor(Math.random() * addresses.length)],
        receiver_country: countries[Math.floor(Math.random() * countries.length)],
        tracking_no: status === 'shipped' ? `TRK${Math.floor(Math.random() * 900000000 + 100000000)}` : null,
        logistics_company: status === 'shipped' ? '合纵物流' : null,
        pay_time: date.toISOString(),
        delivery_deadline: new Date(date.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        remark: Math.random() > 0.7 ? '请尽快发货' : null,
        created_at: date.toISOString(),
        updated_at: date.toISOString(),
      });
    }

    const { error: insertError } = await client
      .from('orders')
      .insert(orders);

    if (insertError) throw insertError;

    // 赠送初始余额 100 元
    const adminClient = getSupabaseClient();
    const { error: rechargeError } = await adminClient
      .from('user_balances')
      .update({
        balance: '100.00',
        total_recharge: '100.00',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (rechargeError) throw rechargeError;

    // 写入充值流水
    const { error: txError } = await adminClient
      .from('wallet_transactions')
      .insert({
        user_id: user.id,
        type: 'recharge',
        amount: '100.00',
        balance_after: '100.00',
        description: '新用户赠送体验金',
      });

    if (txError) throw txError;

    return NextResponse.json({
      success: true,
      message: '演示数据生成成功，已赠送100元体验金',
      count: orders.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '生成演示数据失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
