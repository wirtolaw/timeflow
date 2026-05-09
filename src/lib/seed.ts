import { supabase } from './supabase';

interface CategoryDef {
  name: string;
  color: string;
  icon: string;
  children?: CategoryDef[];
}

const categoryTree: CategoryDef[] = [
  {
    name: '找工作',
    color: '#3b82f6',
    icon: '💼',
    children: [
      { name: '投简历', color: '#60a5fa', icon: '📧' },
      { name: '改简历', color: '#60a5fa', icon: '📝' },
      { name: '浏览JD', color: '#60a5fa', icon: '🔍' },
      { name: '面试准备', color: '#60a5fa', icon: '🎤' },
      { name: 'networking', color: '#60a5fa', icon: '🤝' },
    ],
  },
  {
    name: '学法语',
    color: '#22c55e',
    icon: '🇫🇷',
    children: [
      { name: '课程', color: '#4ade80', icon: '📚' },
      { name: '练习', color: '#4ade80', icon: '✏️' },
      { name: '听力', color: '#4ade80', icon: '🎧' },
      { name: '阅读', color: '#4ade80', icon: '📖' },
    ],
  },
  {
    name: '写小说',
    color: '#8b5cf6',
    icon: '✍️',
    children: [
      { name: '找资料', color: '#a78bfa', icon: '🔎' },
      { name: '写大纲', color: '#a78bfa', icon: '📋' },
      { name: '写正文', color: '#a78bfa', icon: '📄' },
      { name: '改稿', color: '#a78bfa', icon: '🔧' },
    ],
  },
  {
    name: '做app',
    color: '#f97316',
    icon: '📱',
    children: [
      { name: '设计', color: '#fb923c', icon: '🎨' },
      { name: '开发', color: '#fb923c', icon: '💻' },
      { name: '测试', color: '#fb923c', icon: '🧪' },
    ],
  },
  {
    name: '猫',
    color: '#ec4899',
    icon: '🐱',
    children: [
      { name: '喂食/清洁', color: '#f472b6', icon: '🍽️' },
      { name: '玩耍', color: '#f472b6', icon: '🧶' },
      { name: '看医生', color: '#f472b6', icon: '🏥' },
    ],
  },
  {
    name: '生活',
    color: '#78716c',
    icon: '🏠',
    children: [
      { name: '做饭/吃饭', color: '#a8a29e', icon: '🍳' },
      { name: '家务', color: '#a8a29e', icon: '🧹' },
      { name: '出行', color: '#a8a29e', icon: '🚶' },
      { name: '个人护理', color: '#a8a29e', icon: '🧴' },
    ],
  },
  {
    name: '娱乐',
    color: '#ef4444',
    icon: '🎉',
    children: [
      { name: '逛街', color: '#f87171', icon: '🛍️' },
      { name: '看展/演出', color: '#f87171', icon: '🎭' },
      { name: '聚会', color: '#f87171', icon: '🥂' },
      { name: 'SNS', color: '#f87171', icon: '📱' },
      { name: '游戏', color: '#f87171', icon: '🎮' },
      { name: '看剧/电影', color: '#f87171', icon: '🎬' },
      { name: '看书', color: '#f87171', icon: '📕' },
      { name: '音乐', color: '#f87171', icon: '🎵' },
    ],
  },
];

export async function seedCategories(userId: string): Promise<void> {
  // Check if already seeded
  const { count } = await supabase
    .from('tf_categories')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (count && count > 0) return;

  for (let i = 0; i < categoryTree.length; i++) {
    const parent = categoryTree[i];

    const { data: parentData, error: parentError } = await supabase
      .from('tf_categories')
      .insert({
        user_id: userId,
        name: parent.name,
        color: parent.color,
        icon: parent.icon,
        sort_order: i,
        parent_id: null,
      })
      .select('id')
      .single();

    if (parentError || !parentData) {
      console.error('Error seeding parent category:', parentError);
      continue;
    }

    if (parent.children) {
      const childRows = parent.children.map((child, ci) => ({
        user_id: userId,
        name: child.name,
        color: child.color,
        icon: child.icon,
        sort_order: ci,
        parent_id: parentData.id,
      }));

      const { error: childError } = await supabase
        .from('tf_categories')
        .insert(childRows);

      if (childError) {
        console.error('Error seeding child categories:', childError);
      }
    }
  }
}
