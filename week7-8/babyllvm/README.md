# babyllvm

## 程序分析

- `main.py`: 用于读入brainfuck代码，解析后送到llvm的JIT(此处为python binding的llvmlite)去运行
- `runtime.so`: 为bf运行时负责内存分配、检查、读入输出功能。

## JIT逻辑

语法部分和brainfuck一样，在bfProgram的解析函数中，指令节点有linear node和loop node两种。
Linear nodes会被转换成`shortened_code`的数组形式。而后在`shortened_code`中以`(op,imm)`的形式进行codegen

op为1时，操作等同于`data_ptr += imm`
op为2时，操作等同于`*data_ptr += imm`
op为3时，操作等同于`imm.times { print(*ptr); }`,即`imm次输出值`
op为4时，操作等同于`imm.times { read(ptr); }`,即`imm次读入值`

在2，3，4的op中，加入了对指针的范围限制`is_safe`。
op1虽然没加`is_safe`判断，但它的移动会记录在`rel_pos`中。`rel_pos`表示它和原始data_ptr的相对距离。
它会检查`rel_pos`是否在白名单中`whitelist_cpy`.如果不在白名单中，则会调用`runtime.so`里面的`ptrBoundCheck`来检查指针。

`ptrBoundCheck`中会把指针合法范围限制在0x3000长度的data数据中。


`codegen`在解析到`[]`循环分支时，会递归的生成每个block
```
headb = self.head.codegen(module)
br1b = self.br1.codegen(module, (0, 0))
br2b = self.br2.codegen(module, (0, 0))
```
这里传入的`(0, 0)`白名单会导致子块处理中，保持`rel_pos==0`时，`is_safe(0,whitelist_cpy)`永远成立，此时不会添加`ptrBoundCheck`指针检查函数。

这时就能绕过指针检测，对GOT表进行读写操作了。


通过`'+[' + '<' * offset + '[.' + '>' * (offset + 1) + ']]'`的构造，能对`offset`处读一字节(但要求该地址非0，否则就进入不了内层的循环了)。
把`.`改为`,`就能进行对应的写操作。

## 利用
1. 读取write got。(只要读低6字节就行，高位始终为0不需要读)
2. 修改write got为one gadget, 此处用`libc_base+0x10a38c`