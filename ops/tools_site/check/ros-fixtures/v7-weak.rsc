# 2024-05-14 09:12:40 by RouterOS 7.14.3
# software id = 7XQ2-AB1C
#
# model = RB4011iGS+
# serial number = HD0000000XY
/interface bridge
add admin-mac=48:A9:8A:00:00:01 auto-mac=no name=bridge
/interface list
add name=WAN
add name=LAN
/interface bridge port
add bridge=bridge interface=ether2
add bridge=bridge interface=ether3
add bridge=bridge interface=ether4
/interface list member
add interface=ether1 list=WAN
add interface=bridge list=LAN
/ip address
add address=192.168.88.1/24 interface=bridge network=192.168.88.0
/ip dhcp-client
add interface=ether1
/ip dns
set allow-remote-requests=yes servers=1.1.1.1,8.8.8.8
/ip firewall filter
add action=accept chain=input comment="allow ping" protocol=icmp
add action=accept chain=input comment="winbox from anywhere" dst-port=8291 protocol=tcp
add action=accept chain=input comment="ping limited" icmp-options=8:0 limit=5,10:packet protocol=icmp
add action=drop chain=input comment="block telnet" dst-port=23 in-interface-list=WAN protocol=tcp
add action=accept chain=forward connection-state=established,related
/ip firewall nat
add action=masquerade chain=srcnat out-interface-list=WAN
add action=dst-nat chain=dstnat comment="office pc" dst-port=3389 in-interface-list=WAN protocol=tcp to-addresses=192.168.88.20
/ip socks
set enabled=yes
/ip upnp
set enabled=yes
/snmp
set enabled=yes
/system identity
set name=branch-gw
