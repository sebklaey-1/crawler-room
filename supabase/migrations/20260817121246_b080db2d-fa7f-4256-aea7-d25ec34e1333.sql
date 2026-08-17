delete from auth.oauth_clients where client_name = 'diag-probe';
delete from auth.users where id = '02dfb45a-4280-46d3-b31b-e7e012222de5' and is_anonymous = true;