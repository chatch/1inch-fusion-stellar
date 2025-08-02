.PHONY: build test clean

build:
	cargo build --target wasm32-unknown-unknown --release
	cp target/wasm32-unknown-unknown/release/escrow_dst_factory.wasm .

test:
	cargo test

clean:
	cargo clean
	rm -f *.wasm 