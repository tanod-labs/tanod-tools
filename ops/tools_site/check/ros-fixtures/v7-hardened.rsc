# 2024-05-14 09:30:02 by RouterOS 7.14.3
# software id = 7XQ2-AB1C
#
# model = RB4011iGS+
# serial number = HD0000000XY
/interface bridge
add admin-mac=48:A9:8A:00:00:01 auto-mac=no comment=defconf name=bridge
/interface list
add comment=defconf name=WAN
add comment=defconf name=LAN
/interface bridge port
add bridge=bridge comment=defconf interface=ether2
add bridge=bridge comment=defconf interface=ether3
add bridge=bridge comment=defconf interface=ether4
/ip neighbor discovery-settings
set discover-interface-list=LAN
/interface list member
add comment=defconf interface=bridge list=LAN
add comment=defconf interface=ether1 list=WAN
/interface wireguard
add listen-port=13231 mtu=1420 name=wireguard1
/ip address
add address=192.168.88.1/24 comment=defconf interface=bridge network=192.168.88.0
add address=10.66.0.1/24 interface=wireguard1 network=10.66.0.0
/ip dhcp-client
add comment=defconf interface=ether1
/ip dns
set allow-remote-requests=yes
/ip firewall address-list
add address=192.168.88.0/24 list=mgmt
/ip firewall filter
add action=accept chain=input comment="defconf: accept established,related,untracked" connection-state=established,related,untracked
add action=drop chain=input comment="defconf: drop invalid" connection-state=invalid
add action=accept chain=input comment="defconf: accept ICMP" protocol=icmp
add action=accept chain=input comment="defconf: accept to local loopback (for CAPsMAN)" dst-address=127.0.0.1
add action=accept chain=input comment="allow WireGuard" dst-port=13231 protocol=udp
add action=accept chain=input comment="winbox and ssh from mgmt" dst-port=8291,22 protocol=tcp src-address-list=mgmt
add action=drop chain=input comment="defconf: drop all not coming from LAN" in-interface-list=!LAN
add action=accept chain=forward comment="defconf: accept in ipsec policy" ipsec-policy=in,ipsec
add action=accept chain=forward comment="defconf: accept out ipsec policy" ipsec-policy=out,ipsec
add action=fasttrack-connection chain=forward comment="defconf: fasttrack" connection-state=established,related hw-offload=yes
add action=accept chain=forward comment="defconf: accept established,related, untracked" connection-state=established,related,untracked
add action=drop chain=forward comment="defconf: drop invalid" connection-state=invalid
add action=drop chain=forward comment="defconf: drop all from WAN not DSTNATed" connection-nat-state=!dstnat connection-state=new in-interface-list=WAN
/ip firewall nat
add action=masquerade chain=srcnat comment="defconf: masquerade" ipsec-policy=out,none out-interface-list=WAN
/ip service
set telnet disabled=yes
set ftp disabled=yes
set www disabled=yes
set ssh address=192.168.88.0/24
set api disabled=yes
set winbox address=192.168.88.0/24
set api-ssl disabled=yes
/system identity
set name=branch-gw
/tool bandwidth-server
set enabled=no
/tool mac-server
set allowed-interface-list=LAN
/tool mac-server mac-winbox
set allowed-interface-list=LAN
