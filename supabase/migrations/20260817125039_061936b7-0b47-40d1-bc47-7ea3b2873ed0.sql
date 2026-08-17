DELETE FROM auth.oauth_clients WHERE client_name LIKE 'diag-probe-%';
DELETE FROM auth.users WHERE is_anonymous = true AND created_at > now() - interval '20 minutes';