// =====================================================================
// Settings. Fill these in after creating your Supabase project
// (Supabase > Project Settings > API). The anon / publishable key is
// meant to be public; the database rules in supabase/schema.sql are
// what keep data safe. Never put the service_role key here.
// =====================================================================

export const CONFIG = {
  APP_NAME: 'Compatible',

  SUPABASE_URL: 'https://eusqkvselacnpfjzptgp.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_agJDxV3qy1rblck893JqkQ_Vp5nDweU',

  // true  -> share links look like https://yoursite.com/q/adejoke
  //          (needs the rewrite in vercel.json or _redirects)
  // false -> share links look like https://yoursite.com/quiz.html?u=adejoke
  PRETTY_LINKS: true,

  // Shown in the privacy notice for data requests.
  PRIVACY_CONTACT: 'adejoke@kidsthatcode.co',
};
