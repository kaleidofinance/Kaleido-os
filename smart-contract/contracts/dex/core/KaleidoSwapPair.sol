// SPDX-License-Identifier: MIT
pragma solidity =0.6.12;

import '../interfaces/IKaleidoSwapPair.sol';
import './KaleidoSwapERC20.sol';
import '../libraries/Math.sol';
import '../libraries/UQ112x112.sol';
import '../interfaces/IERC20.sol';
import '../interfaces/IKaleidoSwapFactory.sol';
import '../interfaces/IKaleidoSwapCallee.sol';

contract KaleidoSwapPair is IKaleidoSwapPair, KaleidoSwapERC20 {
    using SafeMath for uint;
    using UQ112x112 for uint224;

    uint public constant override MINIMUM_LIQUIDITY = 10 ** 3;
    bytes4 private constant SELECTOR = bytes4(keccak256(bytes('transfer(address,uint256)')));

    address public override factory;
    address public override token0;
    address public override token1;
    uint32 public override swapFee = 30; // default 0.3%

    function name() public view override(IKaleidoSwapPair, KaleidoSwapERC20) returns (string memory) {
        return KaleidoSwapERC20.name();
    }

    function symbol() public view override(IKaleidoSwapPair, KaleidoSwapERC20) returns (string memory) {
        return KaleidoSwapERC20.symbol();
    }

    function decimals() public view override(IKaleidoSwapPair, KaleidoSwapERC20) returns (uint8) {
        return KaleidoSwapERC20.decimals();
    }

    function totalSupply() public view override(IKaleidoSwapPair, KaleidoSwapERC20) returns (uint) {
        return KaleidoSwapERC20.totalSupply();
    }

    function balanceOf(address owner) public view override(IKaleidoSwapPair, KaleidoSwapERC20) returns (uint) {
        return KaleidoSwapERC20.balanceOf(owner);
    }

    function allowance(address owner, address spender) public view override(IKaleidoSwapPair, KaleidoSwapERC20) returns (uint) {
        return KaleidoSwapERC20.allowance(owner, spender);
    }

    function approve(address spender, uint value) public override(IKaleidoSwapPair, KaleidoSwapERC20) returns (bool) {
        return KaleidoSwapERC20.approve(spender, value);
    }

    function transfer(address to, uint value) public override(IKaleidoSwapPair, KaleidoSwapERC20) returns (bool) {
        return KaleidoSwapERC20.transfer(to, value);
    }

    function transferFrom(address from, address to, uint value) public override(IKaleidoSwapPair, KaleidoSwapERC20) returns (bool) {
        return KaleidoSwapERC20.transferFrom(from, to, value);
    }

    function DOMAIN_SEPARATOR() public view override(IKaleidoSwapPair, KaleidoSwapERC20) returns (bytes32) {
        return KaleidoSwapERC20.DOMAIN_SEPARATOR();
    }

    function PERMIT_TYPEHASH() public pure override(IKaleidoSwapPair, KaleidoSwapERC20) returns (bytes32) {
        return KaleidoSwapERC20.PERMIT_TYPEHASH();
    }

    function nonces(address owner) public view override(IKaleidoSwapPair, KaleidoSwapERC20) returns (uint) {
        return KaleidoSwapERC20.nonces(owner);
    }

    function permit(address owner, address spender, uint value, uint deadline, uint8 v, bytes32 r, bytes32 s) public override(IKaleidoSwapPair, KaleidoSwapERC20) {
        KaleidoSwapERC20.permit(owner, spender, value, deadline, v, r, s);
    }

    uint112 private reserve0; // uses single storage slot, accessible via getReserves
    uint112 private reserve1; // uses single storage slot, accessible via getReserves
    uint32 private blockTimestampLast; // uses single storage slot, accessible via getReserves

    uint public override kLast; // reserve0 * reserve1, as of immediately after the most recent liquidity event

    uint public override price0CumulativeLast;
    uint public override price1CumulativeLast;

    uint private unlocked = 1;
    modifier lock() {
        require(unlocked == 1, 'KaleidoSwap: LOCKED');
        unlocked = 0;
        _;
        unlocked = 1;
    }

    function getReserves()
        public
        view
        override
        returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)
    {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    function _safeTransfer(address token, address to, uint value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(SELECTOR, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), 'KaleidoSwap: TRANSFER_FAILED');
    }

    event Mint(address indexed sender, uint amount0, uint amount1);
    event Burn(address indexed sender, uint amount0, uint amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint amount0In,
        uint amount1In,
        uint amount0Out,
        uint amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    constructor() public {
        factory = msg.sender;
    }

    // called once by the factory at time of deployment
    function initialize(address _token0, address _token1, uint32 _swapFee) external override {
        require(msg.sender == factory, 'KaleidoSwap: FORBIDDEN'); // sufficient check
        token0 = _token0;
        token1 = _token1;
        swapFee = _swapFee;
    }

    // update reserves and, on the first call per block, price accumulators
    function _update(uint balance0, uint balance1, uint112 _reserve0, uint112 _reserve1) private {
        require(balance0 <= uint112(-1) && balance1 <= uint112(-1), 'KaleidoSwap: OVERFLOW');
        uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);
        uint32 timeElapsed = blockTimestamp - blockTimestampLast; // overflow is desired
        if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
            // * never overflows, and + overflow is desired
            price0CumulativeLast += uint(UQ112x112.encode(_reserve1).uqdiv(_reserve0)) * timeElapsed;
            price1CumulativeLast += uint(UQ112x112.encode(_reserve0).uqdiv(_reserve1)) * timeElapsed;
        }
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = blockTimestamp;
        emit Sync(reserve0, reserve1);
    }

    // if fee is on, mint liquidity equivalent to 1/6th of the growth in sqrt(k)
    function _mintFee(uint112 _reserve0, uint112 _reserve1) private returns (bool feeOn) {
        address feeTo = IKaleidoSwapFactory(factory).feeTo();
        feeOn = feeTo != address(0);
        uint _kLast = kLast; // gas savings
        if (feeOn) {
            if (_kLast != 0) {
                uint rootK = Math.sqrt(uint(_reserve0).mul(_reserve1));
                uint rootKLast = Math.sqrt(_kLast);
                if (rootK > rootKLast) {
                    uint numerator = _totalSupply.mul(rootK.sub(rootKLast));
                    uint denominator = rootK.mul(5).add(rootKLast);
                    uint liquidity = numerator / denominator;
                    if (liquidity > 0) _mint(feeTo, liquidity);
                }
            }
        } else if (_kLast != 0) {
            kLast = 0;
        }
    }

    // this low-level function should be called from a contract which performs important safety checks
    function mint(address to) external override lock returns (uint liquidity) {
        (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings
        uint balance0 = IERC20(token0).balanceOf(address(this));
        uint balance1 = IERC20(token1).balanceOf(address(this));
        uint amount0 = balance0.sub(_reserve0);
        uint amount1 = balance1.sub(_reserve1);

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint currentSupply = _totalSupply; // gas savings, must be defined here since totalSupply can update in _mintFee
        if (currentSupply == 0) {
            liquidity = Math.sqrt(amount0.mul(amount1)).sub(MINIMUM_LIQUIDITY);
            _mint(address(0), MINIMUM_LIQUIDITY); // permanently lock the first MINIMUM_LIQUIDITY tokens
        } else {
            liquidity = Math.min(amount0.mul(currentSupply) / _reserve0, amount1.mul(currentSupply) / _reserve1);
        }
        require(liquidity > 0, 'KaleidoSwap: INSUFFICIENT_LIQUIDITY_MINTED');
        _mint(to, liquidity);

        _update(balance0, balance1, _reserve0, _reserve1);
        if (feeOn) kLast = uint(reserve0).mul(reserve1); // reserve0 and reserve1 are up-to-date
        emit Mint(msg.sender, amount0, amount1);
    }

    // this low-level function should be called from a contract which performs important safety checks
    function burn(address to) external override lock returns (uint amount0, uint amount1) {
        (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings
        address _token0 = token0; // gas savings
        address _token1 = token1; // gas savings
        uint balance0 = IERC20(_token0).balanceOf(address(this));
        uint balance1 = IERC20(_token1).balanceOf(address(this));
        uint liquidity = _balanceOf[address(this)];

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint currentSupply = _totalSupply; // gas savings, must be defined here since totalSupply can update in _mintFee
        amount0 = liquidity.mul(balance0) / currentSupply; // using balances ensures pro-rata distribution
        amount1 = liquidity.mul(balance1) / currentSupply; // using balances ensures pro-rata distribution
        require(amount0 > 0 && amount1 > 0, 'KaleidoSwap: INSUFFICIENT_LIQUIDITY_BURNED');
        _burn(address(this), liquidity);
        _safeTransfer(_token0, to, amount0);
        _safeTransfer(_token1, to, amount1);
        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));

        _update(balance0, balance1, _reserve0, _reserve1);
        if (feeOn) kLast = uint(reserve0).mul(reserve1); // reserve0 and reserve1 are up-to-date
        emit Burn(msg.sender, amount0, amount1, to);
    }

    // this low-level function should be called from a contract which performs important safety checks
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external override lock {
        require(amount0Out > 0 || amount1Out > 0, 'KaleidoSwap: INSUFFICIENT_OUTPUT_AMOUNT');
        (uint112 _reserve0, uint112 _reserve1, ) = getReserves(); // gas savings
        require(amount0Out < _reserve0 && amount1Out < _reserve1, 'KaleidoSwap: INSUFFICIENT_LIQUIDITY');

        uint balance0;
        uint balance1;
        {
            // scope for _token{0,1}, avoids stack too deep errors
            address _token0 = token0;
            address _token1 = token1;
            require(to != _token0 && to != _token1, 'KaleidoSwap: INVALID_TO');
            if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out); // optimistically transfer tokens
            if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out); // optimistically transfer tokens
            if (data.length > 0) IKaleidoSwapCallee(to).kaleidoSwapCall(msg.sender, amount0Out, amount1Out, data);
            balance0 = IERC20(_token0).balanceOf(address(this));
            balance1 = IERC20(_token1).balanceOf(address(this));
        }
        uint amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, 'KaleidoSwap: INSUFFICIENT_INPUT_AMOUNT');
        {
            // scope for reserve{0,1}Adjusted, avoids stack too deep errors
            uint balance0Adjusted = balance0.mul(10000).sub(amount0In.mul(swapFee));
            uint balance1Adjusted = balance1.mul(10000).sub(amount1In.mul(swapFee));
            require(
                balance0Adjusted.mul(balance1Adjusted) >= uint(_reserve0).mul(_reserve1).mul(10000 ** 2),
                'KaleidoSwap: K'
            );
        }

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    // force balances to match reserves
    function sync() external override lock {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)), reserve0, reserve1);
    }
    
    function skim(address to) external override lock {
        address _token0 = token0; // gas savings
        address _token1 = token1; // gas savings
        _safeTransfer(_token0, to, IERC20(_token0).balanceOf(address(this)).sub(reserve0));
        _safeTransfer(_token1, to, IERC20(_token1).balanceOf(address(this)).sub(reserve1));
    }
}
