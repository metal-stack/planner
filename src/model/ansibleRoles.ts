// Variables of the metal-stack Ansible roles the Ansible export may set,
// per source. Like the hardware catalog mirrors the official compatibility
// list, this mirrors the role READMEs and defaults of metal-stack/metal-roles
// (checked against v0.17.26, commit 4a9a436, 2026-09-18) plus the release
// vector variables of mini-lab's inventory. Update it from there, don't
// invent entries: ansible.test.ts fails on any generated variable that is
// not listed here.

export const METAL_ROLES_REPO = 'https://github.com/metal-stack/metal-roles'
export const ANSIBLE_COMMON_REPO = 'https://github.com/metal-stack/ansible-common'

export const ROLE_VARIABLES: Record<string, readonly string[]> = {
  // Ansible connection variables.
  ansible: ['ansible_host', 'ansible_user', 'ansible_become', 'ansible_python_interpreter'],
  // Release vector mapping (common/roles/defaults, mini-lab group_vars/all).
  'common/defaults': ['metal_stack_release_version', 'metal_stack_release_vectors'],
  // control-plane/roles/defaults: the ingress domain metal-api (api.<it>)
  // and NSQ (<it>:4150) are served under.
  'control-plane/defaults': ['metal_control_plane_ingress_dns'],
  // partition/README.md, partition/roles/defaults.
  'partition/defaults': [
    'metal_partition_id',
    'metal_partition_mgmt_gateway',
    'metal_partition_timezone',
    'metal_partition_metal_api_addr',
    'metal_partition_metal_api_port',
    'metal_partition_metal_api_protocol',
    'metal_partition_metal_api_basepath',
    'metal_partition_metal_api_hmac_edit_key',
    'metal_partition_metal_api_hmac_view_key',
    'metal_partition_metal_api_grpc_address',
    'metal_partition_metal_api_grpc_cert_dir',
    'metal_partition_metal_api_grpc_ca_cert',
    'metal_partition_metal_api_grpc_client_cert',
    'metal_partition_metal_api_grpc_client_key',
  ],
  // partition/roles/sonic-config (replaces the deprecated sonic role).
  'sonic-config': [
    'sonic_config_asn',
    'sonic_config_bgp_ports',
    'sonic_config_breakouts',
    'sonic_config_docker_routing_config_mode',
    'sonic_config_extended_cacl',
    'sonic_config_features',
    'sonic_config_frr_l2vpn_evpn',
    'sonic_config_frr_mgmt_framework_config',
    'sonic_config_frr_render',
    'sonic_config_frr_route_map',
    'sonic_config_frr_static_routes',
    'sonic_config_frr_static_routes_mgmt',
    'sonic_config_frr_syslog_level',
    'sonic_config_interconnects',
    'sonic_config_lldp_hello_timer',
    'sonic_config_loopback_address',
    'sonic_config_mclag',
    'sonic_config_mgmt_interface',
    'sonic_config_mgmt_vrf',
    'sonic_config_nameservers',
    'sonic_config_ntp',
    'sonic_config_portchannels',
    'sonic_config_ports',
    'sonic_config_reload_config',
    'sonic_config_sag',
    'sonic_config_ssh_sourceranges',
    'sonic_config_timezone',
    'sonic_config_vlan_subinterfaces',
    'sonic_config_vlans',
    'sonic_config_vtep',
  ],
  // partition/roles/metal-core; `lo` and `asn` are read by its env template.
  'metal-core': [
    'lo',
    'asn',
    'metal_core_cidr',
    'metal_core_rack_id',
    'metal_core_spine_uplinks',
    'metal_core_log_level',
    'metal_core_pxe_vlan_id',
    'metal_core_additional_bridge_vids',
    'metal_core_additional_bridge_ports',
  ],
  'mgmt-server': [
    'mgmt_server_asn',
    'mgmt_server_router_id',
    // Read by the role's frr.conf.j2 (the assert checks mgmt_server_router_id).
    'mgmt_server_routerid',
    'mgmt_server_spine_facing_interface',
    'mgmt_server_firewall_facing_interface',
    'mgmt_server_firewall_ip',
    'mgmt_server_nameservers',
    'mgmt_server_metal_ssh_privkey',
    'mgmt_server_metal_ssh_pubkey',
  ],
  dhcp: ['dhcp_subnets', 'dhcp_global_options', 'dhcp_static_hosts'],
  pixiecore: ['pixiecore_api_host', 'pixiecore_dns_servers', 'pixiecore_metal_hammer_ntp_servers'],
  'metal-bmc': [
    'metal_bmc_allowed_cidrs',
    'metal_bmc_bmc_superuser',
    'metal_bmc_bmc_superuser_pwd',
    'metal_bmc_nsqd_addr',
    'metal_bmc_nsqd_ca_cert',
    'metal_bmc_nsqd_client_cert',
    'metal_bmc_nsqd_client_cert_key',
    'metal_bmc_console_ca_cert',
    'metal_bmc_console_cert',
    'metal_bmc_console_key',
  ],
  'image-cache': ['image_cache_sync_metal_api_endpoint', 'image_cache_sync_metal_api_view_hmac'],
}

export const KNOWN_VARIABLES: ReadonlySet<string> = new Set(Object.values(ROLE_VARIABLES).flat())
