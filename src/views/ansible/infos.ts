import { DOCS, type Info } from '../plan/docs'

export const ANSIBLE_INFO = {
  tab: {
    text: 'An Ansible inventory, group and host variables for the metal-roles partition roles (sonic-config on every switch, metal-core on the leaves, dhcp, metal-bmc, pixiecore and image-cache on the management servers) and the playbooks that apply them. Hostnames, ASNs, loopbacks, management addresses, PXE networks and DHCP ranges come from the plan and the IPs tab; secrets, endpoints and switch ports are left as CHANGE_ME.',
  },
  asn: {
    text: 'Private 4-byte ASNs (4200000000 to 4294967294). Leaves get unique ASNs, spines share one and exit switches share one, as the metal-stack network docs suggest against BGP path hunting. Each partition takes a block of 100000 above this number.',
    href: DOCS.networking,
    linkLabel: 'Networking',
  },
  placeholders: {
    text: 'Values the plan cannot know: secrets and certificates (group_vars/partition/secrets.yaml, encrypt it with ansible-vault), the control plane endpoints, NIC names of the management servers and the switch ports, which depend on the cabling.',
  },
} satisfies Record<string, Info>
