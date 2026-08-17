delete from auth.oauth_clients where client_name like 'diag-probe%';
delete from auth.users where is_anonymous = true and created_at > now() - interval '40 minutes';